import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  CLIO_LANGUAGES, DEFAULT_CAR_PREFS, crc16CcittText, crc16CcittBytes,
  buildClp3Dest, buildClp3TripStop, buildClp3Fave, buildClp3Prefs,
  buildClp3Cancel, buildClp3SkipStop, buildClp3Clock,
  buildClp3QrStart, buildClp3QrAck, buildClp3QrDone, buildClp3Ping,
  packCarPrefs, unpackCarPrefs, diffCarPrefs, optimizeStops2Opt, haversineMeters
} from "../protocol.js";
import {
  b64UrlEncode, parseConnectQrUrl, parseSyncFrame, QrSyncAssembler,
  decodeSyncBundle, isPointInMapBbox, computePendingSyncDelta
} from "../qr-sync.js";
import { computeItineraryProgress } from "../trip-rail.js";
import { LANGUAGES, isRtlLanguage, detectOsLanguage, indexForLanguage, languageForIndex } from "../i18n.js";
import { buildClp3TripPackets } from "../trip-store.js";
import { buildBackupPayload, restoreBackupPayload, savePlace, savePreset, loadPlaces, loadPresets, loadCarState, SAVED_KEY, SAVED_MAX } from "../places-store.js";

function memoryStorage() {
  const map = new Map();
  return {
    getItem: k => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: k => { map.delete(k); }
  };
}

test("CLP3 packet builders produce valid CRC-16-CCITT signed frames matching clioa2dp.c", () => {
  const verify = pkt => {
    assert.equal(pkt.album, "CLIOPLAY-NAV");
    const lastColon = pkt.title.lastIndexOf(":");
    const body = pkt.title.slice(0, lastColon);
    const crcHex = pkt.title.slice(lastColon + 1);
    assert.equal(crcHex, crc16CcittText(body).toString(16).toUpperCase().padStart(4, "0"));
  };
  const d = buildClp3Dest(54.9783, -1.6178, "Café Łódź", 0x0042, "N");
  verify(d);
  assert.match(d.title, /^CLP3:N:5497830:-161780:0042:[0-9A-F]{4}$/);
  assert.equal(d.artist, "Café Łódź");

  const t = buildClp3TripStop(1, 3, 0x0a, 55.0145, -1.6942, "Kingston Park", 0x0043);
  verify(t);
  assert.match(t.title, /^CLP3:T:1:3:0A:5501450:-169420:0043:[0-9A-F]{4}$/);

  const f = buildClp3Fave(1, 54.99, -1.60, "Home", 0x0044);
  verify(f);
  assert.match(f.title, /^CLP3:F:1:5499000:-160000:0044:[0-9A-F]{4}$/);

  const p = buildClp3Prefs({ ...DEFAULT_CAR_PREFS, bright: 75, language: 7, navChimes: 2 }, 0x0045);
  verify(p);
  assert.match(p.title, /^CLP3:P:[0-9A-F]{24}:0045:[0-9A-F]{4}$/);

  verify(buildClp3Cancel(0x46));
  verify(buildClp3SkipStop(0x47));
  verify(buildClp3Clock(1764288000, 60, 0x48));
  verify(buildClp3QrStart(0x49));
  verify(buildClp3QrAck(2, 0x4a));
  verify(buildClp3QrDone(0x4b));
  verify(buildClp3Ping(0x4c));
  assert.match(buildClp3Ping(0x4c).title, /^CLP3:H:3:004C:[0-9A-F]{4}$/);

  let seq = 1;
  const sched = buildClp3TripPackets([
    { name: "Stop 1", lat: 54.97, lon: -1.61 },
    { name: "End", lat: 55.01, lon: -1.69 }
  ], () => seq++, 7);
  assert.equal(sched.length, 2);
  assert.match(sched[0].packet.title, /^CLP3:T:0:2:07:/);
  assert.match(sched[1].packet.title, /^CLP3:T:1:2:07:/);
});

test("12-byte car prefs packer matches ClioPlay clio_prefs_pack()/unpack() bit-for-bit", () => {
  const sample = {
    bright: 65, theme: 1, units: 2, cameras: 2, navChimes: 2,
    autozoom: false, clockAuto: false, topSwap: true, bottomSwap: true,
    learnHistory: false, destPred: false, diversions: false, debug: true,
    language: 17, gpsHud: true, dayStart: 390, nightStart: 1290, tzMin: -300
  };
  const bytes = packCarPrefs(sample);
  assert.equal(bytes.length, 12);
  assert.equal(bytes[0], 1);
  assert.equal(bytes[1], 65);
  assert.equal(bytes[2], 1 | (2 << 2) | (2 << 4) | (2 << 6));
  assert.equal(bytes[3], 4 | 8 | 128);
  assert.equal(bytes[4], 17);
  assert.equal(bytes[5], 1);
  assert.deepEqual(unpackCarPrefs(bytes), sample);
  assert.equal(unpackCarPrefs(new Uint8Array(12)), null); // version 0 invalid
  assert.deepEqual(diffCarPrefs(sample, { ...sample, bright: 80, units: 1 }), ["bright", "units"]);
});

test("Connect QR parser, CS1 stacked assembler, binary decoder & out-of-map bbox work end-to-end", () => {
  const conn = parseConnectQrUrl("https://pxwel-dev.github.io/ClioPlay-Send/#q=C1.3.0.0.GB.21.5000.5880.-620.180");
  assert.deepEqual(conn, {
    kind: "connect",
    version: "3.0.0",
    regionIso: "GB",
    units: 2,
    imperial: true,
    mapBbox: { minLat: 50, maxLat: 58.8, minLon: -6.2, maxLon: 1.8 }
  });
  assert.equal(isPointInMapBbox(54.9783, -1.6178, conn.mapBbox), true);
  assert.equal(isPointInMapBbox(48.8566, 2.3522, conn.mapBbox), false);

  // Build synthetic CS v1 bundle with header + Faves + CRC-16
  const prefsBytes = packCarPrefs({ ...DEFAULT_CAR_PREFS, bright: 90, language: 7 });
  const faveName = new TextEncoder().encode("Café");
  const faveSec = new Uint8Array(1 + 9 + faveName.length);
  const fv = new DataView(faveSec.buffer);
  faveSec[0] = 1;
  fv.setInt32(1, 5497830, true);
  fv.setInt32(5, -161780, true);
  faveSec[9] = faveName.length;
  faveSec.set(faveName, 10);

  const raw = new Uint8Array(29 + 3 + faveSec.length + 2);
  const rv = new DataView(raw.buffer);
  raw[0] = 0x43; raw[1] = 0x53; raw[2] = 1; raw[3] = 7;
  raw[4] = 3; raw[5] = 0; raw[6] = 0;
  raw[7] = 0x47; raw[8] = 0x42; // GB
  rv.setInt16(9, 5000, true); rv.setInt16(11, 5880, true);
  rv.setInt16(13, -620, true); rv.setInt16(15, 180, true);
  raw.set(prefsBytes, 17);
  raw[29] = 0x01;
  rv.setUint16(30, faveSec.length, true);
  raw.set(faveSec, 32);
  rv.setUint16(raw.length - 2, crc16CcittBytes(raw.subarray(0, raw.length - 2)), true);

  // Split into 2 stacked frames and assemble out-of-order!
  const f1 = parseSyncFrame(`CS1:AB:1/2:${b64UrlEncode(raw.subarray(20))}`);
  const f0 = parseSyncFrame(`CS1:AB:0/2:${b64UrlEncode(raw.subarray(0, 20))}`);
  const asm = new QrSyncAssembler();
  let st = asm.addFrame(f1);
  assert.equal(st.complete, false);
  assert.equal(st.nextMissing, 0);
  st = asm.addFrame(f0);
  assert.equal(st.complete, true);
  const bundle = asm.assemble();
  assert.equal(bundle.version, "3.0.0");
  assert.equal(bundle.regionIso, "GB");
  assert.equal(bundle.prefs.bright, 90);
  assert.equal(bundle.prefs.language, 7);
  assert.equal(bundle.favourites.length, 1);
  assert.equal(bundle.favourites[0].name, "Café");
});

test("Pending-sync delta tracker detects phone-only additions, renames, deletes & pref changes", () => {
  const snap = {
    prefs: { ...DEFAULT_CAR_PREFS },
    favourites: [
      { name: "Home", lat: 54.99, lon: -1.60 },
      { name: "Old Gym", lat: 54.98, lon: -1.62 }
    ]
  };
  const phone = {
    carPrefs: { ...DEFAULT_CAR_PREFS, bright: 50 },
    savedPlaces: [
      { name: "Home Sweet Home", lat: 54.99, lon: -1.60, role: "home" }, // renamed!
      { name: "New Cafe", lat: 54.97, lon: -1.61 } // added!
      // Old Gym deleted!
    ]
  };
  const delta = computePendingSyncDelta(phone, snap);
  assert.equal(delta.toAddOrRename.length, 2);
  assert.equal(delta.toDelete.length, 1);
  assert.equal(delta.toDelete[0].place.name, "Old Gym");
  assert.deepEqual(delta.changedPrefKeys, ["bright"]);
  assert.equal(delta.totalChanges, 4);
  assert.equal(delta.isPlaceSynced(phone.savedPlaces[1]), false);
});

test("Offline 2-opt stop optimiser shortens zig-zag multi-stop itinerary while keeping final destination fixed", () => {
  const origin = { lat: 54.95, lon: -1.60 };
  const stops = [
    { name: "Far North", lat: 55.10, lon: -1.60 },
    { name: "Close South", lat: 54.96, lon: -1.60 },
    { name: "Mid", lat: 55.02, lon: -1.60 },
    { name: "Final Airport", lat: 55.04, lon: -1.70 }
  ];
  const opt = optimizeStops2Opt(stops, { origin, keepFinalFixed: true });
  assert.equal(opt[opt.length - 1].name, "Final Airport");
  const dist = arr => {
    let s = haversineMeters(origin.lat, origin.lon, arr[0].lat, arr[0].lon);
    for (let i = 0; i + 1 < arr.length; i++) s += haversineMeters(arr[i].lat, arr[i].lon, arr[i + 1].lat, arr[i + 1].lon);
    return s;
  };
  assert.ok(dist(opt) < dist(stops));
  assert.equal(opt[0].name, "Close South");
});

test("Live itinerary progress marks passed stops within 120 m and advances active index", () => {
  const stops = [
    { name: "Stop 1", lat: 54.97, lon: -1.61 },
    { name: "Stop 2", lat: 55.00, lon: -1.62 }
  ];
  const prog = computeItineraryProgress(stops, { lat: 54.9702, lon: -1.6101 });
  assert.equal(prog.passedIndices.has(0), true);
  assert.equal(prog.activeIndex, 1);
});

test("1-file JSON backup exports & restores saved places, presets and car prefs", () => {
  const store = memoryStorage();
  savePlace(store, { name: "Home", lat: 54.99, lon: -1.60, role: "home" });
  savePreset(store, "Weekend Loop", [{ name: "A", lat: 54.97, lon: -1.61 }, { name: "B", lat: 55.01, lon: -1.65 }]);
  const json = JSON.stringify(buildBackupPayload(store));
  const fresh = memoryStorage();
  restoreBackupPayload(fresh, json);
  assert.equal(loadPlaces(fresh, SAVED_KEY, SAVED_MAX)[0].name, "Home");
  assert.equal(loadPresets(fresh)[0].name, "Weekend Loop");
  assert.ok(loadCarState(fresh).carPrefs.bright >= 10);
});

test("All 18 ClioPlay languages exist with 100% key parity, placeholder parity & RTL flags", async () => {
  assert.equal(LANGUAGES.length, 18);
  assert.deepEqual(LANGUAGES, CLIO_LANGUAGES);
  assert.equal(isRtlLanguage("ar"), true);
  assert.equal(isRtlLanguage("he"), true);
  assert.equal(isRtlLanguage("en"), false);
  assert.equal(detectOsLanguage(["zh-CN", "en-US"]), "zh-Hans");
  assert.equal(detectOsLanguage(["pl-PL"]), "pl");
  assert.equal(languageForIndex(indexForLanguage("ja")), "ja");

  const en = JSON.parse(await readFile(new URL("../locales/en.json", import.meta.url), "utf8"));
  const enKeys = Object.keys(en).sort();
  assert.ok(enKeys.length >= 150);
  const ph = s => [...String(s).matchAll(/\{[a-zA-Z0-9_]+\}/g)].map(m => m[0]).sort();

  for (const code of LANGUAGES) {
    const dict = JSON.parse(await readFile(new URL(`../locales/${code}.json`, import.meta.url), "utf8"));
    const keys = Object.keys(dict).sort();
    assert.deepEqual(keys, enKeys, `Locale ${code} key mismatch`);
    for (const k of enKeys) {
      assert.equal(typeof dict[k], "string", `${code}.${k} must be string`);
      assert.ok(dict[k].trim().length > 0, `${code}.${k} must not be empty`);
      assert.deepEqual(ph(dict[k]), ph(en[k]), `${code}.${k} placeholder mismatch`);
    }
  }
});

test("DOM IDs in app.js and data-i18n keys in index.html are 100% consistent", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const appJs = await readFile(new URL("../app.js", import.meta.url), "utf8");
  const en = JSON.parse(await readFile(new URL("../locales/en.json", import.meta.url), "utf8"));
  const htmlIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
  const missingIds = [...new Set([...appJs.matchAll(/\$\("([^"]+)"\)/g)].map(m => m[1]).filter(id => !htmlIds.has(id)))];
  assert.deepEqual(missingIds, []);
  const missingHtmlI18n = [...new Set([...html.matchAll(/data-i18n(?:-[a-z]+)?="([^"]+)"/g)].map(m => m[1]).filter(k => !(k in en)))];
  assert.deepEqual(missingHtmlI18n, []);
});
