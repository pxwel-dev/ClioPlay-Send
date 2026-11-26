import { validCoords, sanitiseAvrcpName, buildPacket } from "./parser.js?v=20261126-5";

export const TRIP_KEY = "clp-trip-queue";
export const PARKED_KEY = "clp-parked-spot";
export const TRIP_MAX = 10; // Matches TRIP_MAX_TARGETS in ClioPlay clio040.c

function normaliseStop(entry) {
  if (!entry || typeof entry !== "object") return null;
  const lat = Number(entry.lat);
  const lon = Number(entry.lon);
  if (!validCoords(lat, lon)) return null;
  const rawName = typeof entry.name === "string" ? entry.name.trim() : "";
  const name = rawName ? sanitiseAvrcpName(rawName) : "Phone destination";
  return { name, lat: Number(lat.toFixed(6)), lon: Number(lon.toFixed(6)) };
}

function writeJson(storage, key, value) {
  if (!storage) return;
  try {
    if (value === null) storage.removeItem(key);
    else storage.setItem(key, JSON.stringify(value));
  } catch { }
}

export function loadTrip(storage) {
  if (!storage) return [];
  try {
    const raw = storage.getItem(TRIP_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out = [];
    for (const item of parsed) {
      const clean = normaliseStop(item);
      if (!clean) continue;
      out.push(clean);
      if (out.length >= TRIP_MAX) break;
    }
    return out;
  } catch {
    return [];
  }
}

export function addTripStop(storage, stop) {
  const clean = normaliseStop(stop);
  const current = loadTrip(storage);
  if (!clean || current.length >= TRIP_MAX) return current;
  const next = [...current, clean];
  writeJson(storage, TRIP_KEY, next);
  return next;
}

export function removeTripStop(storage, index) {
  const current = loadTrip(storage);
  if (index < 0 || index >= current.length) return current;
  const next = current.filter((_, i) => i !== index);
  writeJson(storage, TRIP_KEY, next);
  return next;
}

export function moveTripStop(storage, index, delta) {
  const current = loadTrip(storage);
  const target = index + delta;
  if (index < 0 || index >= current.length || target < 0 || target >= current.length || index === target) {
    return current;
  }
  const next = current.slice();
  [next[index], next[target]] = [next[target], next[index]];
  writeJson(storage, TRIP_KEY, next);
  return next;
}

export function saveTrip(storage, stops) {
  const clean = Array.isArray(stops) ? stops.map(normaliseStop).filter(Boolean).slice(0, TRIP_MAX) : [];
  writeJson(storage, TRIP_KEY, clean.length ? clean : null);
  return clean;
}

export function clearTrip(storage) {
  writeJson(storage, TRIP_KEY, null);
  return [];
}

/**
 * Build the exact CLP2 transmission sequence matching ClioPlay clio040.c:
 * - First transmit the final destination with action "N" (replaces active route).
 * - Then transmit stops 0 .. length-2 in forward order with action "S"
 *   (trip_add_stop inserts each stop at index count-1, right before the final
 *   destination, yielding exact itinerary order [stop0, stop1, ..., final]).
 */
export function buildTripPackets(stops, nextSeqFn) {
  if (!Array.isArray(stops) || stops.length === 0) return [];
  const valid = stops.map(normaliseStop).filter(Boolean).slice(0, TRIP_MAX);
  if (!valid.length) return [];

  const finalIdx = valid.length - 1;
  const finalStop = valid[finalIdx];
  const schedule = [{
    stopIndex: finalIdx,
    stop: finalStop,
    action: "N",
    packet: buildPacket(finalStop.lat, finalStop.lon, finalStop.name, nextSeqFn(), "N")
  }];

  for (let i = 0; i < finalIdx; i++) {
    const stop = valid[i];
    schedule.push({
      stopIndex: i,
      stop,
      action: "S",
      packet: buildPacket(stop.lat, stop.lon, stop.name, nextSeqFn(), "S")
    });
  }
  return schedule;
}

export function loadParkedSpot(storage) {
  if (!storage) return null;
  try {
    const raw = storage.getItem(PARKED_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const clean = normaliseStop(parsed);
    if (!clean) return null;
    const at = Number.isFinite(Number(parsed.at)) ? Number(parsed.at) : 0;
    const accuracy = Number.isFinite(Number(parsed.accuracy)) && Number(parsed.accuracy) >= 0
      ? Math.round(Number(parsed.accuracy))
      : null;
    return { ...clean, at, accuracy };
  } catch {
    return null;
  }
}

export function saveParkedSpot(storage, spot, now = Date.now()) {
  const clean = normaliseStop({ name: spot?.name || "Parked car", lat: spot?.lat, lon: spot?.lon });
  if (!clean) return loadParkedSpot(storage);
  const accuracy = Number.isFinite(Number(spot?.accuracy)) && Number(spot?.accuracy) >= 0
    ? Math.round(Number(spot.accuracy))
    : null;
  const saved = { ...clean, at: Number.isFinite(Number(now)) ? Number(now) : Date.now(), accuracy };
  writeJson(storage, PARKED_KEY, saved);
  return saved;
}

export function clearParkedSpot(storage) {
  writeJson(storage, PARKED_KEY, null);
  return null;
}
