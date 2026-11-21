import test from "node:test";
import assert from "node:assert/strict";
import { sanitiseAvrcpName, buildPacket } from "../parser.js";
import {
  RECENT_KEY, SAVED_KEY, RECENT_MAX, SAVED_MAX,
  storageAvailable, loadPlaces, recordRecent, clearRecents,
  findSavedIndex, savePlace, removeSavedPlace
} from "../places-store.js";

function memoryStorage() {
  const map = new Map();
  return {
    getItem: k => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: k => { map.delete(k); },
  };
}

test("sanitiseAvrcpName preserves international UTF-8 scripts and enforces 40-char / 160-byte bounds", () => {
  assert.equal(sanitiseAvrcpName("Café de Flore"), "Café de Flore");
  assert.equal(sanitiseAvrcpName("Łódź Fabryczna"), "Łódź Fabryczna");
  assert.equal(sanitiseAvrcpName("München Hauptbahnhof"), "München Hauptbahnhof");
  assert.equal(sanitiseAvrcpName("東京駅"), "東京駅");
  assert.equal(sanitiseAvrcpName("서울역"), "서울역");
  assert.equal(sanitiseAvrcpName("Москва"), "Москва");
  assert.equal(sanitiseAvrcpName("القاهرة"), "القاهرة");
  assert.equal(sanitiseAvrcpName("תל אביב"), "תל אביב");
  assert.equal(sanitiseAvrcpName("नई दिल्ली"), "नई दिल्ली");
  // Combining accent normalizes to precomposed NFC.
  assert.equal(sanitiseAvrcpName("Cafe\u0301"), "Café");
  // Control and zero-width chars are stripped and whitespace collapses.
  assert.equal(sanitiseAvrcpName("  Shell\u0007\tStation\u200B\nNorth "), "Shell Station North");
  assert.equal(sanitiseAvrcpName("   \u0000\u200B  "), "PHONE DESTINATION");
  // Clamps at 40 code points and <= 160 UTF-8 bytes without splitting surrogate pairs.
  const longEmoji = "🚗".repeat(50);
  const clamped = sanitiseAvrcpName(longEmoji);
  assert.equal([...clamped].length, 40);
  assert.equal(new TextEncoder().encode(clamped).length, 160);
  const packet = buildPacket(54.97032, -1.60208, "Łódź Café 東京", 0x1234, "S");
  assert.equal(packet.album, "CLIOPLAY-NAV");
  assert.equal(packet.artist, "Łódź Café 東京");
  assert.match(packet.title, /^CLP2:S:5497032:-160208:1234:[0-9A-F]{4}$/);
});

test("places-store handles storage probing and blocked storage gracefully", () => {
  const store = memoryStorage();
  assert.equal(storageAvailable(store), true);
  assert.equal(storageAvailable({ setItem() { throw Error("blocked"); }, removeItem() {} }), false);
  assert.deepEqual(loadPlaces({ getItem() { throw Error("blocked"); } }, SAVED_KEY, SAVED_MAX), []);
  store.setItem(SAVED_KEY, "{not json");
  assert.deepEqual(loadPlaces(store, SAVED_KEY, SAVED_MAX), []);
});

test("recent sends deduplicate, preserve stop/route action, cap at RECENT_MAX and clear", () => {
  const store = memoryStorage();
  for (let i = 0; i < RECENT_MAX + 3; i++) {
    recordRecent(store, { name: `Place ${i}`, lat: 50 + i * 0.01, lon: -1.5, action: i % 2 ? "S" : "N" }, 1000 + i);
  }
  let recents = loadPlaces(store, RECENT_KEY, RECENT_MAX);
  assert.equal(recents.length, RECENT_MAX);
  assert.equal(recents[0].name, `Place ${RECENT_MAX + 2}`);
  // Resending a nearby coordinate moves it to the top with its new name/action.
  recents = recordRecent(store, { name: "Updated Café", lat: 50.05003, lon: -1.50002, action: "S" }, 9999);
  assert.equal(recents.length, RECENT_MAX);
  assert.equal(recents[0].name, "Updated Café");
  assert.equal(recents[0].action, "S");
  assert.equal(recents.filter(p => Math.abs(p.lat - 50.05) < 0.001).length, 1);
  assert.deepEqual(clearRecents(store), []);
  assert.deepEqual(loadPlaces(store, RECENT_KEY, RECENT_MAX), []);
});

test("saved places add, update in place, remove and cap at SAVED_MAX", () => {
  const store = memoryStorage();
  let saved = savePlace(store, { name: "Home", lat: 54.9783, lon: -1.6178 });
  assert.equal(saved.length, 1);
  assert.equal(findSavedIndex(saved, 54.97834, -1.61776), 0);
  // Saving at same coordinates updates the name rather than creating a duplicate.
  saved = savePlace(store, { name: "Home (Łódź)", lat: 54.97834, lon: -1.61776 });
  assert.equal(saved.length, 1);
  assert.equal(saved[0].name, "Home (Łódź)");
  saved = removeSavedPlace(store, 0);
  assert.equal(saved.length, 0);
  for (let i = 0; i < SAVED_MAX + 4; i++) {
    saved = savePlace(store, { name: `Pin ${i}`, lat: 51 + i * 0.01, lon: -0.1 });
  }
  assert.equal(saved.length, SAVED_MAX);
});
