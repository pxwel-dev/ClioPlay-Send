import test from "node:test";
import assert from "node:assert/strict";
import { parseShareParams } from "../parser.js";
import {
  TRIP_MAX, loadTrip, addTripStop, removeTripStop, moveTripStop, saveTrip, clearTrip,
  buildTripPackets, loadParkedSpot, saveParkedSpot, clearParkedSpot
} from "../trip-store.js";

function memoryStorage() {
  const map = new Map();
  return {
    getItem: k => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: k => { map.delete(k); },
  };
}

test("trip-store adds, reorders, removes, clears, and caps at TRIP_MAX (10)", () => {
  const store = memoryStorage();
  assert.deepEqual(loadTrip(store), []);

  let list = addTripStop(store, { name: "Heron Foods", lat: 54.971118, lon: -1.617628 });
  list = addTripStop(store, { name: "Petrol Station", lat: 54.9801, lon: -1.605 });
  list = addTripStop(store, { name: "Home", lat: 54.9912, lon: -1.59 });
  assert.deepEqual(list.map(s => s.name), ["Heron Foods", "Petrol Station", "Home"]);

  list = moveTripStop(store, 1, -1);
  assert.deepEqual(list.map(s => s.name), ["Petrol Station", "Heron Foods", "Home"]);

  list = moveTripStop(store, 0, 1);
  assert.deepEqual(list.map(s => s.name), ["Heron Foods", "Petrol Station", "Home"]);

  // Out-of-bounds moves are safe no-ops
  assert.deepEqual(moveTripStop(store, 0, -1).map(s => s.name), ["Heron Foods", "Petrol Station", "Home"]);
  assert.deepEqual(moveTripStop(store, 2, 1).map(s => s.name), ["Heron Foods", "Petrol Station", "Home"]);

  list = removeTripStop(store, 1);
  assert.deepEqual(list.map(s => s.name), ["Heron Foods", "Home"]);

  // Cap at TRIP_MAX (10 matching clio040.c TRIP_MAX_TARGETS)
  for (let i = 0; i < TRIP_MAX + 5; i++) {
    list = addTripStop(store, { name: `Stop ${i}`, lat: 51 + i * 0.01, lon: -0.1 });
  }
  assert.equal(list.length, TRIP_MAX);

  assert.deepEqual(clearTrip(store), []);
  assert.deepEqual(loadTrip(store), []);

  // saveTrip persists an arbitrary reordered list directly
  const savedDirect = saveTrip(store, [
    { name: "Home", lat: 54.9912, lon: -1.59 },
    { name: "Heron Foods", lat: 54.971118, lon: -1.617628 }
  ]);
  assert.deepEqual(savedDirect.map(s => s.name), ["Home", "Heron Foods"]);
  assert.deepEqual(loadTrip(store).map(s => s.name), ["Home", "Heron Foods"]);
});

test("buildTripPackets matches ClioPlay clio040.c set_destination + trip_add_stop order", () => {
  const stops = [
    { name: "Heron Foods", lat: 54.971118, lon: -1.617628 },
    { name: "Shell North", lat: 54.981, lon: -1.602 },
    { name: "Airport", lat: 55.0375, lon: -1.6917 },
    { name: "Home", lat: 54.992, lon: -1.58 }
  ];
  let seq = 100;
  const schedule = buildTripPackets(stops, () => ++seq);
  assert.equal(schedule.length, 4);

  // Packet 0 sets final destination with action N; packets 1..3 add stops 0..2 with action S
  assert.equal(schedule[0].action, "N");
  assert.equal(schedule[0].stop.name, "Home");
  assert.match(schedule[0].packet.title, /^CLP2:N:/);
  for (let i = 1; i < schedule.length; i++) {
    assert.equal(schedule[i].action, "S");
    assert.match(schedule[i].packet.title, /^CLP2:S:/);
  }

  // Exact simulation of clio040.c phone_destination_apply() + trip_add_stop()
  let carTrip = [];
  for (const entry of schedule) {
    if (entry.action === "N") {
      carTrip = [entry.packet.artist];
    } else {
      const ins = carTrip.length - 1;
      carTrip.splice(ins, 0, entry.packet.artist);
    }
  }
  assert.deepEqual(carTrip, ["Heron Foods", "Shell North", "Airport", "Home"]);

  // Single-stop trip sends just one N packet
  const single = buildTripPackets([stops[0]], () => ++seq);
  assert.equal(single.length, 1);
  assert.equal(single[0].action, "N");
  assert.equal(single[0].stop.name, "Heron Foods");
});

test("parked spot stores, loads with timestamp + accuracy, and clears cleanly", () => {
  const store = memoryStorage();
  assert.equal(loadParkedSpot(store), null);
  const saved = saveParkedSpot(store, { lat: 54.971118, lon: -1.617628, accuracy: 8.4 }, 1700000000000);
  assert.deepEqual(saved, {
    name: "Parked car",
    lat: 54.971118,
    lon: -1.617628,
    at: 1700000000000,
    accuracy: 8
  });
  assert.deepEqual(loadParkedSpot(store), saved);
  assert.equal(clearParkedSpot(store), null);
  assert.equal(loadParkedSpot(store), null);
});

test("parseShareParams handles iOS Shortcuts URLs, direct coords, action=stop, and trip=1", () => {
  assert.equal(parseShareParams(""), null);

  // Standard iOS Shortcut / Android Share Sheet text
  const textShare = parseShareParams("?text=Check+out%0AHeron+Foods%0Ahttps%3A%2F%2Fcomaps.at%2F4tfxZ6WK7g%2FHeron_Foods&action=stop");
  assert.equal(textShare.kind, "text");
  assert.equal(textShare.action, "S");
  assert.equal(textShare.addToTrip, false);
  assert.match(textShare.text, /comaps\.at\/4tfxZ6WK7g/);

  // Direct lat/lon (and lng alias) with trip=1
  const direct = parseShareParams("?lat=54.971118&lng=-1.617628&name=Heron+Foods&trip=1");
  assert.deepEqual(direct, {
    kind: "coords",
    lat: 54.971118,
    lon: -1.617628,
    name: "Heron Foods",
    action: "",
    addToTrip: true
  });

  // add=trip + action=new
  const tripText = parseShareParams("?q=https://maps.app.goo.gl/abc123&add=trip&action=new");
  assert.equal(tripText.kind, "text");
  assert.equal(tripText.action, "N");
  assert.equal(tripText.addToTrip, true);

  // Invalid coordinates fall back cleanly instead of throwing
  assert.equal(parseShareParams("?lat=999&lon=0"), null);
});
