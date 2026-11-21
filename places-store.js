import { validCoords, sanitiseAvrcpName } from "./parser.js?v=20261121";

export const RECENT_KEY = "clp-recent-sends";
export const SAVED_KEY = "clp-saved-places";
export const RECENT_MAX = 8;
export const SAVED_MAX = 20;
const SAME_PLACE_DEG = 0.00008;

export function samePlace(a, b) {
  return Boolean(a && b) &&
    Math.abs(a.lat - b.lat) <= SAME_PLACE_DEG &&
    Math.abs(a.lon - b.lon) <= SAME_PLACE_DEG;
}

export function storageAvailable(storage = globalThis.localStorage) {
  if (!storage) return false;
  const probe = "__clp_probe__";
  try {
    storage.setItem(probe, "1");
    storage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

function normaliseEntry(entry) {
  if (!entry || typeof entry !== "object") return null;
  const lat = Number(entry.lat);
  const lon = Number(entry.lon);
  if (!validCoords(lat, lon)) return null;
  const rawName = typeof entry.name === "string" ? entry.name.trim() : "";
  const name = rawName ? sanitiseAvrcpName(rawName) : "Phone destination";
  const action = entry.action === "S" ? "S" : "N";
  const at = Number.isFinite(Number(entry.at)) ? Number(entry.at) : 0;
  return { name, lat: Number(lat.toFixed(6)), lon: Number(lon.toFixed(6)), action, at };
}

export function loadPlaces(storage, key, limit) {
  if (!storage) return [];
  try {
    const raw = storage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out = [];
    for (const item of parsed) {
      const clean = normaliseEntry(item);
      if (!clean || out.some(existing => samePlace(existing, clean))) continue;
      out.push(clean);
      if (out.length >= limit) break;
    }
    return out;
  } catch {
    return [];
  }
}

function writePlaces(storage, key, list) {
  if (!storage) return;
  try { storage.setItem(key, JSON.stringify(list)); } catch { }
}

export function recordRecent(storage, place, now = Date.now()) {
  const clean = normaliseEntry({ ...place, at: now });
  if (!clean) return loadPlaces(storage, RECENT_KEY, RECENT_MAX);
  const current = loadPlaces(storage, RECENT_KEY, RECENT_MAX)
    .filter(item => !samePlace(item, clean));
  const next = [clean, ...current].slice(0, RECENT_MAX);
  writePlaces(storage, RECENT_KEY, next);
  return next;
}

export function clearRecents(storage) {
  if (storage) {
    try { storage.removeItem(RECENT_KEY); } catch { }
  }
  return [];
}

export function findSavedIndex(saved, lat, lon) {
  if (!validCoords(lat, lon)) return -1;
  return saved.findIndex(item => samePlace(item, { lat, lon }));
}

export function savePlace(storage, place, now = Date.now()) {
  const clean = normaliseEntry({ ...place, action: "N", at: now });
  if (!clean) return loadPlaces(storage, SAVED_KEY, SAVED_MAX);
  const current = loadPlaces(storage, SAVED_KEY, SAVED_MAX);
  const idx = findSavedIndex(current, clean.lat, clean.lon);
  let next;
  if (idx >= 0) {
    next = current.map((item, i) => (i === idx ? clean : item));
  } else {
    next = [clean, ...current].slice(0, SAVED_MAX);
  }
  writePlaces(storage, SAVED_KEY, next);
  return next;
}

export function removeSavedPlace(storage, index) {
  const current = loadPlaces(storage, SAVED_KEY, SAVED_MAX);
  if (index < 0 || index >= current.length) return current;
  const next = current.filter((_, i) => i !== index);
  writePlaces(storage, SAVED_KEY, next);
  return next;
}
