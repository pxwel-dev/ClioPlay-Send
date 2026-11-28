import { sanitiseAvrcpName, validCoords } from "./parser.js";

export const ALBUM_ID = "CLIOPLAY-NAV";

export const CLIO_LANGUAGES = [
  "en", "fr", "es", "de", "it", "pt", "nl", "pl", "tr",
  "el", "uk", "ru", "ar", "zh-Hans", "ja", "ko", "hi", "he"
];

export const DEFAULT_CAR_PREFS = Object.freeze({
  bright: 80,            // 10..100
  theme: 2,              // 0=Day, 1=Night, 2=Auto
  units: 0,              // 0=Auto, 1=Metric, 2=Imperial
  cameras: 1,            // 0=Off, 1=On, 2=Silent
  navChimes: 1,          // 0=Off, 1=Link only, 2=All cues
  autozoom: true,
  clockAuto: true,
  topSwap: false,
  bottomSwap: false,
  learnHistory: true,
  destPred: true,
  diversions: true,
  debug: false,
  language: 0,           // 0..17 index into CLIO_LANGUAGES
  gpsHud: false,
  dayStart: 420,         // minutes since midnight (07:00)
  nightStart: 1200,      // minutes since midnight (20:00)
  tzMin: 0               // -720..840 (UTC offset in minutes, east positive)
});

export function crc16CcittBytes(bytes) {
  let crc = 0xffff;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i] << 8;
    for (let b = 0; b < 8; b++) {
      crc = (crc & 0x8000) ? (((crc << 1) ^ 0x1021) & 0xffff) : ((crc << 1) & 0xffff);
    }
  }
  return crc;
}

export function crc16CcittText(text) {
  let crc = 0xffff;
  for (let i = 0; i < text.length; i++) {
    crc ^= (text.charCodeAt(i) & 0xff) << 8;
    for (let b = 0; b < 8; b++) {
      crc = (crc & 0x8000) ? (((crc << 1) ^ 0x1021) & 0xffff) : ((crc << 1) & 0xffff);
    }
  }
  return crc;
}

function hex4(n) {
  return (n & 0xffff).toString(16).toUpperCase().padStart(4, "0");
}

function hex2(n) {
  return (n & 0xff).toString(16).toUpperCase().padStart(2, "0");
}

function coordInt(deg) {
  return Math.round(Number(deg) * 1e5);
}

function signClp3(body, seq, artist = "ClioPlay Link") {
  const s = (Number(seq) & 0xffff) || 1;
  const payload = `${body}:${hex4(s)}`;
  const crc = hex4(crc16CcittText(payload));
  return {
    title: `${payload}:${crc}`,
    artist: artist ? sanitiseAvrcpName(artist) : "ClioPlay Link",
    album: ALBUM_ID,
    seq: s,
    version: 3
  };
}

export function buildClp3Dest(lat, lon, name, seq, action = "N") {
  if (!validCoords(lat, lon)) throw new RangeError("Invalid coordinates");
  const act = action === "S" ? "S" : "N";
  return signClp3(`CLP3:${act}:${coordInt(lat)}:${coordInt(lon)}`, seq, name || "Phone destination");
}

export function buildClp3TripStop(idx, total, batchId, lat, lon, name, seq) {
  if (!validCoords(lat, lon)) throw new RangeError("Invalid coordinates");
  if (total < 1 || total > 10 || idx < 0 || idx >= total) throw new RangeError("Invalid trip stop index");
  return signClp3(
    `CLP3:T:${idx}:${total}:${hex2(batchId)}:${coordInt(lat)}:${coordInt(lon)}`,
    seq,
    name || "Phone destination"
  );
}

export function buildClp3Fave(op, lat, lon, name, seq) {
  if (op < 0 || op > 4) throw new RangeError("Invalid fave op");
  const la = op === 4 ? 0 : coordInt(lat);
  const lo = op === 4 ? 0 : coordInt(lon);
  if (op !== 4 && !validCoords(lat, lon)) throw new RangeError("Invalid coordinates");
  return signClp3(`CLP3:F:${op}:${la}:${lo}`, seq, op === 4 ? "CLEAR" : (name || "Saved place"));
}

export function buildClp3Prefs(prefs, seq) {
  const bytes = packCarPrefs(prefs);
  let hex = "";
  for (let i = 0; i < 12; i++) hex += hex2(bytes[i]);
  return signClp3(`CLP3:P:${hex}`, seq, "Settings");
}

export function buildClp3Cancel(seq) {
  return signClp3("CLP3:C:X", seq, "Cancel route");
}

export function buildClp3SkipStop(seq) {
  return signClp3("CLP3:C:K", seq, "Skip stop");
}

export function buildClp3Clock(utcSeconds, tzMin, seq) {
  const u = Math.max(0, Math.floor(Number(utcSeconds) || 0)) >>> 0;
  const tz = Math.max(-720, Math.min(840, Math.round(Number(tzMin) || 0)));
  return signClp3(`CLP3:C:T:${u.toString(16).toUpperCase()}:${tz}`, seq, "Clock sync");
}

export function buildClp3QrStart(seq) {
  return signClp3("CLP3:Q:S", seq, "QR sync");
}

export function buildClp3QrAck(nextIdx, seq) {
  const i = Math.max(0, Math.min(63, Math.floor(Number(nextIdx) || 0)));
  return signClp3(`CLP3:Q:A:${i}`, seq, "QR ack");
}

export function buildClp3QrDone(seq) {
  return signClp3("CLP3:Q:D", seq, "QR done");
}

export function buildClp3Ping(seq) {
  return signClp3("CLP3:H:3", seq, "Ping");
}

/* Exact 12-byte bit-for-bit match with ClioPlay clio040.c clio_prefs_pack()/unpack(). */
export function normaliseCarPrefs(raw = {}) {
  const clamp = (v, lo, hi, fb) => {
    const n = Math.round(Number(v));
    if (!Number.isFinite(n)) return fb;
    return Math.max(lo, Math.min(hi, n));
  };
  return {
    bright: clamp(raw.bright, 10, 100, DEFAULT_CAR_PREFS.bright),
    theme: clamp(raw.theme, 0, 2, DEFAULT_CAR_PREFS.theme),
    units: clamp(raw.units, 0, 2, DEFAULT_CAR_PREFS.units),
    cameras: clamp(raw.cameras, 0, 2, DEFAULT_CAR_PREFS.cameras),
    navChimes: clamp(raw.navChimes, 0, 2, DEFAULT_CAR_PREFS.navChimes),
    autozoom: raw.autozoom !== undefined ? Boolean(raw.autozoom) : DEFAULT_CAR_PREFS.autozoom,
    clockAuto: raw.clockAuto !== undefined ? Boolean(raw.clockAuto) : DEFAULT_CAR_PREFS.clockAuto,
    topSwap: raw.topSwap !== undefined ? Boolean(raw.topSwap) : DEFAULT_CAR_PREFS.topSwap,
    bottomSwap: raw.bottomSwap !== undefined ? Boolean(raw.bottomSwap) : DEFAULT_CAR_PREFS.bottomSwap,
    learnHistory: raw.learnHistory !== undefined ? Boolean(raw.learnHistory) : DEFAULT_CAR_PREFS.learnHistory,
    destPred: raw.destPred !== undefined ? Boolean(raw.destPred) : DEFAULT_CAR_PREFS.destPred,
    diversions: raw.diversions !== undefined ? Boolean(raw.diversions) : DEFAULT_CAR_PREFS.diversions,
    debug: raw.debug !== undefined ? Boolean(raw.debug) : DEFAULT_CAR_PREFS.debug,
    language: clamp(raw.language, 0, CLIO_LANGUAGES.length - 1, DEFAULT_CAR_PREFS.language),
    gpsHud: raw.gpsHud !== undefined ? Boolean(raw.gpsHud) : DEFAULT_CAR_PREFS.gpsHud,
    dayStart: clamp(raw.dayStart, 0, 1439, DEFAULT_CAR_PREFS.dayStart),
    nightStart: clamp(raw.nightStart, 0, 1439, DEFAULT_CAR_PREFS.nightStart),
    tzMin: clamp(raw.tzMin, -720, 840, DEFAULT_CAR_PREFS.tzMin)
  };
}

export function packCarPrefs(raw) {
  const p = normaliseCarPrefs(raw);
  const out = new Uint8Array(12);
  out[0] = 1;
  out[1] = p.bright & 0xff;
  out[2] = (p.theme & 3) | ((p.units & 3) << 2) | ((p.cameras & 3) << 4) | ((p.navChimes & 3) << 6);
  out[3] =
    (p.autozoom ? 1 : 0) |
    (p.clockAuto ? 2 : 0) |
    (p.topSwap ? 4 : 0) |
    (p.bottomSwap ? 8 : 0) |
    (p.learnHistory ? 16 : 0) |
    (p.destPred ? 32 : 0) |
    (p.diversions ? 64 : 0) |
    (p.debug ? 128 : 0);
  out[4] = p.language & 0xff;
  out[5] = p.gpsHud ? 1 : 0;
  out[6] = p.dayStart & 0xff;
  out[7] = (p.dayStart >> 8) & 0xff;
  out[8] = p.nightStart & 0xff;
  out[9] = (p.nightStart >> 8) & 0xff;
  const tz = p.tzMin & 0xffff;
  out[10] = tz & 0xff;
  out[11] = (tz >> 8) & 0xff;
  return out;
}

export function unpackCarPrefs(bytes) {
  if (!bytes || bytes.length < 12 || bytes[0] !== 1) return null;
  const bright = bytes[1];
  const theme = bytes[2] & 3;
  const units = (bytes[2] >> 2) & 3;
  const cameras = (bytes[2] >> 4) & 3;
  const navChimes = (bytes[2] >> 6) & 3;
  const language = bytes[4];
  const gpsHud = bytes[5];
  const dayStart = bytes[6] | (bytes[7] << 8);
  const nightStart = bytes[8] | (bytes[9] << 8);
  let tzMin = bytes[10] | (bytes[11] << 8);
  if (tzMin >= 0x8000) tzMin -= 0x10000;
  if (bright < 10 || bright > 100 || theme > 2 || units > 2 || cameras > 2 || navChimes > 2 ||
      language >= CLIO_LANGUAGES.length || gpsHud > 1 || dayStart >= 1440 || nightStart >= 1440 ||
      tzMin < -720 || tzMin > 840) {
    return null;
  }
  const f = bytes[3];
  return {
    bright,
    theme,
    units,
    cameras,
    navChimes,
    autozoom: Boolean(f & 1),
    clockAuto: Boolean(f & 2),
    topSwap: Boolean(f & 4),
    bottomSwap: Boolean(f & 8),
    learnHistory: Boolean(f & 16),
    destPred: Boolean(f & 32),
    diversions: Boolean(f & 64),
    debug: Boolean(f & 128),
    language,
    gpsHud: Boolean(gpsHud),
    dayStart,
    nightStart,
    tzMin
  };
}

export function diffCarPrefs(current, snapshot) {
  if (!snapshot) return [];
  const a = normaliseCarPrefs(current);
  const b = normaliseCarPrefs(snapshot);
  const changed = [];
  for (const key of Object.keys(DEFAULT_CAR_PREFS)) {
    if (a[key] !== b[key]) changed.push(key);
  }
  return changed;
}

/* Geodesic math & offline 2-opt multi-stop optimiser. */
const RAD = Math.PI / 180;

export function haversineMeters(lat1, lon1, lat2, lon2) {
  const dLat = (lat2 - lat1) * RAD;
  const dLon = (lon2 - lon1) * RAD;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
}

export function bearingDeg(lat1, lon1, lat2, lon2) {
  const y = Math.sin((lon2 - lon1) * RAD) * Math.cos(lat2 * RAD);
  const x = Math.cos(lat1 * RAD) * Math.sin(lat2 * RAD) -
    Math.sin(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.cos((lon2 - lon1) * RAD);
  return ((Math.atan2(y, x) / RAD) + 360) % 360;
}

export function formatDistance(metres, imperial = false) {
  const m = Math.max(0, Number(metres) || 0);
  if (imperial) {
    const miles = m / 1609.344;
    if (miles < 0.25) return `${Math.max(10, Math.round((m * 1.09361) / 10) * 10)} yd`;
    if (miles < 10) return `${miles.toFixed(1)} mi`;
    return `${Math.round(miles)} mi`;
  }
  if (m < 950) return `${Math.max(10, Math.round(m / 10) * 10)} m`;
  const km = m / 1000;
  return km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`;
}

export function formatDuration(seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  if (s < 60) return "<1 min";
  const mins = Math.round(s / 60);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const rm = mins % 60;
  return rm ? `${h} h ${rm} min` : `${h} h`;
}

/**
 * Offline 2-opt stop optimiser. Keeps `origin` (if provided) as the starting point
 * and keeps the final stop fixed when `keepFinalFixed` is true (default), reordering
 * intermediate stops to minimise total straight-line distance.
 */
export function optimizeStops2Opt(stops, { origin = null, keepFinalFixed = true } = {}) {
  if (!Array.isArray(stops) || stops.length < 3) return stops ? stops.slice() : [];
  const fixedEnd = keepFinalFixed ? stops[stops.length - 1] : null;
  const middle = keepFinalFixed ? stops.slice(0, -1) : stops.slice();
  if (middle.length < 2) return stops.slice();

  const startPt = origin && validCoords(origin.lat, origin.lon) ? origin : middle[0];
  let order = middle.slice();

  // Nearest-neighbour seed from startPt
  if (origin && validCoords(origin.lat, origin.lon)) {
    const rem = middle.slice();
    order = [];
    let cur = startPt;
    while (rem.length) {
      let best = 0, bestD = Infinity;
      for (let i = 0; i < rem.length; i++) {
        const d = haversineMeters(cur.lat, cur.lon, rem[i].lat, rem[i].lon);
        if (d < bestD) { bestD = d; best = i; }
      }
      cur = rem.splice(best, 1)[0];
      order.push(cur);
    }
  }

  const tourCost = arr => {
    let total = 0;
    if (origin && validCoords(origin.lat, origin.lon)) {
      total += haversineMeters(origin.lat, origin.lon, arr[0].lat, arr[0].lon);
    }
    for (let i = 0; i + 1 < arr.length; i++) {
      total += haversineMeters(arr[i].lat, arr[i].lon, arr[i + 1].lat, arr[i + 1].lon);
    }
    if (fixedEnd) {
      total += haversineMeters(arr[arr.length - 1].lat, arr[arr.length - 1].lon, fixedEnd.lat, fixedEnd.lon);
    }
    return total;
  };

  let bestCost = tourCost(order);
  const startIdx = origin ? 0 : 1;
  let improved = true;
  let guard = 0;
  while (improved && guard++ < 64) {
    improved = false;
    for (let i = startIdx; i < order.length - 1; i++) {
      for (let j = i + 1; j < order.length; j++) {
        const cand = [
          ...order.slice(0, i),
          ...order.slice(i, j + 1).reverse(),
          ...order.slice(j + 1)
        ];
        const c = tourCost(cand);
        if (c + 1 < bestCost) {
          order = cand;
          bestCost = c;
          improved = true;
        }
      }
    }
  }
  return fixedEnd ? [...order, fixedEnd] : order;
}
