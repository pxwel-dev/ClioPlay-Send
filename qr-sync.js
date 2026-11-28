import { crc16CcittBytes, unpackCarPrefs, diffCarPrefs, normaliseCarPrefs } from "./protocol.js";
import { samePlace } from "./places-store.js";

const TEXT_DECODER = new TextDecoder("utf-8", { fatal: false });
const EPOCH_2000_MS = Date.UTC(2000, 0, 1, 0, 0, 0);

export function b64UrlDecode(str) {
  if (typeof str !== "string" || !str.length) return new Uint8Array(0);
  const clean = str.replace(/-/g, "+").replace(/_/g, "/");
  const pad = clean.length % 4 ? "=".repeat(4 - (clean.length % 4)) : "";
  const bin = atob(clean + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function b64UrlEncode(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Parse Connect QR URL emitted by ClioPlay P_PAIR & P_PHONE_ACTIONS:
 *   https://pxwel-dev.github.io/ClioPlay-Send/#q=C1.<maj>.<min>.<pat>.<iso>.<units><imp>.<la0>.<la1>.<lo0>.<lo1>
 * Also accepts raw hash `#q=C1...` or payload `C1...`.
 */
export function parseConnectQrUrl(input) {
  if (typeof input !== "string") return null;
  let token = input.trim();
  const hashIdx = token.indexOf("#q=");
  if (hashIdx >= 0) token = token.slice(hashIdx + 3);
  else if (token.startsWith("q=")) token = token.slice(2);
  const ampIdx = token.indexOf("&");
  if (ampIdx >= 0) token = token.slice(0, ampIdx);
  const parts = token.split(".");
  if (parts.length !== 10 || parts[0] !== "C1") return null;
  const maj = Number(parts[1]), min = Number(parts[2]), pat = Number(parts[3]);
  if (![maj, min, pat].every(n => Number.isInteger(n) && n >= 0 && n <= 255)) return null;
  const iso = /^[A-Z]{2}$/.test(parts[4]) ? parts[4] : "";
  const up = parts[5];
  if (!/^[0-2][01]$/.test(up)) return null;
  const units = Number(up[0]);
  const imperial = up[1] === "1";
  const la0 = Number(parts[6]), la1 = Number(parts[7]), lo0 = Number(parts[8]), lo1 = Number(parts[9]);
  if (![la0, la1, lo0, lo1].every(n => Number.isInteger(n) && n >= -18000 && n <= 18000)) return null;
  const hasBbox = !(la0 === 0 && la1 === 0 && lo0 === 0 && lo1 === 0) && la0 < la1 && lo0 < lo1;
  return {
    kind: "connect",
    version: `${maj}.${min}.${pat}`,
    regionIso: iso,
    units,
    imperial,
    mapBbox: hasBbox ? { minLat: la0 / 100, maxLat: la1 / 100, minLon: lo0 / 100, maxLon: lo1 / 100 } : null
  };
}

/**
 * Parse a single stacked sync QR frame: `CS1:<sid2hex>:<idx>/<tot>:<base64url>`
 */
export function parseSyncFrame(text) {
  if (typeof text !== "string") return null;
  const m = /^CS1:([0-9A-Fa-f]{2}):(\d{1,2})\/(\d{1,2}):([A-Za-z0-9_-]+)$/.exec(text.trim());
  if (!m) return null;
  const sid = m[1].toUpperCase();
  const index = Number(m[2]);
  const total = Number(m[3]);
  if (!Number.isInteger(index) || !Number.isInteger(total) || total < 1 || total > 15 || index < 0 || index >= total) {
    return null;
  }
  let bytes;
  try { bytes = b64UrlDecode(m[4]); } catch { return null; }
  if (!bytes.length) return null;
  return { kind: "sync-frame", sid, index, total, bytes };
}

export class QrSyncAssembler {
  constructor() {
    this.reset();
  }
  reset() {
    this.sid = "";
    this.total = 0;
    this.frames = new Map();
  }
  addFrame(frame) {
    if (!frame || frame.kind !== "sync-frame") return { accepted: false, isNew: false };
    if (this.sid !== frame.sid || this.total !== frame.total) {
      this.sid = frame.sid;
      this.total = frame.total;
      this.frames = new Map();
    }
    const isNew = !this.frames.has(frame.index);
    if (isNew) this.frames.set(frame.index, frame.bytes);
    return {
      accepted: true,
      isNew,
      received: this.frames.size,
      total: this.total,
      complete: this.frames.size === this.total,
      nextMissing: this.nextMissingIndex()
    };
  }
  nextMissingIndex() {
    if (!this.total) return 0;
    for (let i = 0; i < this.total; i++) {
      if (!this.frames.has(i)) return i;
    }
    return -1;
  }
  assemble() {
    if (!this.total || this.frames.size !== this.total) return null;
    let totalLen = 0;
    for (let i = 0; i < this.total; i++) totalLen += this.frames.get(i).length;
    const merged = new Uint8Array(totalLen);
    let off = 0;
    for (let i = 0; i < this.total; i++) {
      const chunk = this.frames.get(i);
      merged.set(chunk, off);
      off += chunk.length;
    }
    return decodeSyncBundle(merged);
  }
}

export function decodeSyncBundle(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 31) return null;
  if (bytes[0] !== 0x43 || bytes[1] !== 0x53 || bytes[2] !== 1) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const payloadEnd = bytes.length - 2;
  const gotCrc = view.getUint16(payloadEnd, true);
  const expCrc = crc16CcittBytes(bytes.subarray(0, payloadEnd));
  if (gotCrc !== expCrc) return null;

  const flags = bytes[3];
  const version = `${bytes[4]}.${bytes[5]}.${bytes[6]}`;
  const isoRaw = String.fromCharCode(bytes[7], bytes[8]);
  const regionIso = /^[A-Z]{2}$/.test(isoRaw) ? isoRaw : "";
  const la0 = view.getInt16(9, true), la1 = view.getInt16(11, true);
  const lo0 = view.getInt16(13, true), lo1 = view.getInt16(15, true);
  const hasBbox = Boolean(flags & 1) && !(la0 === 0 && la1 === 0 && lo0 === 0 && lo1 === 0) && la0 < la1 && lo0 < lo1;
  const prefs = unpackCarPrefs(bytes.subarray(17, 29));
  if (!prefs) return null;

  const out = {
    version,
    regionIso,
    mapOk: Boolean(flags & 1),
    imperial: Boolean(flags & 2),
    learnHistory: Boolean(flags & 4),
    clockValid: Boolean(flags & 8),
    mapBbox: hasBbox ? { minLat: la0 / 100, maxLat: la1 / 100, minLon: lo0 / 100, maxLon: lo1 / 100 } : null,
    prefs,
    favourites: [],
    activeTrip: null,
    recents: [],
    insights: null
  };

  let pos = 29;
  while (pos + 3 <= payloadEnd) {
    const tag = bytes[pos];
    const blen = view.getUint16(pos + 1, true);
    pos += 3;
    if (pos + blen > payloadEnd) return null;
    const sec = bytes.subarray(pos, pos + blen);
    const sv = new DataView(sec.buffer, sec.byteOffset, sec.byteLength);

    if (tag === 0x01 && blen >= 1) {
      const cnt = sec[0];
      let p = 1;
      for (let i = 0; i < cnt && p + 9 <= blen; i++) {
        const lat = sv.getInt32(p, true) / 1e5;
        const lon = sv.getInt32(p + 4, true) / 1e5;
        const nlen = sec[p + 8];
        p += 9;
        if (p + nlen > blen) break;
        const name = TEXT_DECODER.decode(sec.subarray(p, p + nlen)) || "Saved place";
        p += nlen;
        out.favourites.push({ name, lat, lon });
      }
    } else if (tag === 0x02 && blen >= 9) {
      const cnt = sec[0];
      const totalDistM = sv.getUint32(1, true);
      const totalDurS = sv.getUint32(5, true);
      let p = 9;
      const stops = [];
      for (let i = 0; i < cnt && p + 17 <= blen; i++) {
        const lat = sv.getInt32(p, true) / 1e5;
        const lon = sv.getInt32(p + 4, true) / 1e5;
        const legDistM = sv.getUint32(p + 8, true);
        const legDurS = sv.getUint32(p + 12, true);
        const nlen = sec[p + 16];
        p += 17;
        if (p + nlen > blen) break;
        const name = TEXT_DECODER.decode(sec.subarray(p, p + nlen)) || "Stop";
        p += nlen;
        stops.push({ name, lat, lon, legDistM, legDurS });
      }
      if (stops.length) out.activeTrip = { totalDistM, totalDurS, stops };
    } else if (tag === 0x03 && blen >= 1) {
      const cnt = sec[0];
      let p = 1;
      for (let i = 0; i < cnt && p + 9 <= blen; i++) {
        const lat = sv.getInt32(p, true) / 1e5;
        const lon = sv.getInt32(p + 4, true) / 1e5;
        const nlen = sec[p + 8];
        p += 9;
        if (p + nlen > blen) break;
        const name = TEXT_DECODER.decode(sec.subarray(p, p + nlen)) || "Recent";
        p += nlen;
        out.recents.push({ name, lat, lon });
      }
    } else if (tag === 0x04 && blen >= 52) {
      const journeyCount = sv.getUint16(0, true);
      const totalDistM = sv.getUint32(2, true);
      const totalDurS = sv.getUint32(6, true);
      const longestDistM = sv.getUint32(10, true);
      const dayCounts = [];
      for (let i = 0; i < 7; i++) dayCounts.push(sv.getUint16(14 + i * 2, true));
      const hour2Counts = Array.from(sec.subarray(28, 40));
      const clsPace = {
        motorway: sec[40],
        aRoad: sec[41],
        bRoad: sec[42],
        local: sec[43]
      };
      const coldPace = sec[44];
      const learnedRoads = sv.getUint16(45, true);
      const learnedParking = sec[47];
      const learnedStops = sec[48];
      const learnedHazards = sec[49];
      const brightDay = sec[50];
      const brightNight = sec[51];
      let p = 52;
      const topPlaces = [];
      if (p < blen) {
        const tn = sec[p++];
        for (let i = 0; i < tn && p + 11 <= blen; i++) {
          const lat = sv.getInt32(p, true) / 1e5;
          const lon = sv.getInt32(p + 4, true) / 1e5;
          const visits = sv.getUint16(p + 8, true);
          const nlen = sec[p + 10];
          p += 11;
          if (p + nlen > blen) break;
          const name = TEXT_DECODER.decode(sec.subarray(p, p + nlen));
          p += nlen;
          topPlaces.push({ lat, lon, visits, name });
        }
      }
      const hazards = [];
      if (p < blen) {
        const hn = sec[p++];
        for (let i = 0; i < hn && p + 10 <= blen; i++) {
          const lat = sv.getInt32(p, true) / 1e5;
          const lon = sv.getInt32(p + 4, true) / 1e5;
          const count = sec[p + 8];
          const coldCount = sec[p + 9];
          p += 10;
          hazards.push({ lat, lon, count, coldCount });
        }
      }
      const recentDrives = [];
      if (p < blen) {
        const dn = sec[p++];
        for (let i = 0; i < dn && p + 19 <= blen; i++) {
          const lat = sv.getInt32(p, true) / 1e5;
          const lon = sv.getInt32(p + 4, true) / 1e5;
          const departEpoch2000 = sv.getUint32(p + 8, true);
          const distM = sv.getUint32(p + 12, true);
          const durS = sv.getUint16(p + 16, true);
          const nlen = sec[p + 18];
          p += 19;
          if (p + nlen > blen) break;
          const name = TEXT_DECODER.decode(sec.subarray(p, p + nlen));
          p += nlen;
          recentDrives.push({
            lat, lon,
            departMs: departEpoch2000 === 0xffffffff ? null : EPOCH_2000_MS + departEpoch2000 * 1000,
            distM, durS, name
          });
        }
      }
      out.insights = {
        journeyCount, totalDistM, totalDurS, longestDistM,
        dayCounts, hour2Counts, clsPace, coldPace,
        learnedRoads, learnedParking, learnedStops, learnedHazards,
        brightDay, brightNight, topPlaces, hazards, recentDrives
      };
    }
    pos += blen;
  }
  return out;
}

export function isPointInMapBbox(lat, lon, bbox) {
  if (!bbox || !Number.isFinite(lat) || !Number.isFinite(lon)) return true;
  return lat >= bbox.minLat - 0.02 && lat <= bbox.maxLat + 0.02 &&
    lon >= bbox.minLon - 0.02 && lon <= bbox.maxLon + 0.02;
}

/**
 * Compute exact pending sync delta between phone state and last car-confirmed snapshot.
 */
export function computePendingSyncDelta(phoneState, carSnapshot) {
  const phoneFaves = Array.isArray(phoneState?.savedPlaces) ? phoneState.savedPlaces : [];
  const carFaves = Array.isArray(carSnapshot?.favourites) ? carSnapshot.favourites : [];

  const toAddOrRename = [];
  for (const pf of phoneFaves) {
    const match = carFaves.find(cf => samePlace(cf, pf));
    if (!match || match.name !== pf.name) {
      toAddOrRename.push({ op: pf.role === "home" ? 1 : pf.role === "work" ? 2 : 0, place: pf, isRename: Boolean(match) });
    }
  }
  const toDelete = [];
  if (carSnapshot) {
    for (const cf of carFaves) {
      if (!phoneFaves.some(pf => samePlace(pf, cf))) {
        toDelete.push({ op: 3, place: cf });
      }
    }
  }

  const changedPrefKeys = carSnapshot?.prefs
    ? diffCarPrefs(normaliseCarPrefs(phoneState?.carPrefs), carSnapshot.prefs)
    : [];

  const unsyncedPlaceCount = toAddOrRename.length + toDelete.length;
  const totalChanges = unsyncedPlaceCount + (changedPrefKeys.length ? 1 : 0);
  return {
    toAddOrRename,
    toDelete,
    changedPrefKeys,
    unsyncedPlaceCount,
    prefsDirty: changedPrefKeys.length > 0,
    totalChanges,
    isPlaceSynced(place) {
      if (!carSnapshot) return false;
      const m = carFaves.find(cf => samePlace(cf, place));
      return Boolean(m && m.name === place.name);
    }
  };
}
