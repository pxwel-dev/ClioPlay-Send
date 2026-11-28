import { validCoords, sanitiseAvrcpName } from "./parser.js";
import { DEFAULT_CAR_PREFS, normaliseCarPrefs } from "./protocol.js";

export const RECENT_KEY = "clp-recent-sends";
export const SAVED_KEY = "clp-saved-places";
export const PRESETS_KEY = "clp-trip-presets";
export const CAR_STATE_KEY = "clp-car-state";
export const RECENT_MAX = 10;
export const SAVED_MAX = 25; // Matches ClioPlay clio040.c FAVE_MAX
export const PRESETS_MAX = 12;
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
  const out = { name, lat: Number(lat.toFixed(6)), lon: Number(lon.toFixed(6)), action, at };
  if (entry.role === "home" || entry.role === "work") out.role = entry.role;
  return out;
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
  delete clean.role;
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
  let current = loadPlaces(storage, SAVED_KEY, SAVED_MAX);
  if (clean.role) {
    current = current.map(item => (item.role === clean.role ? { ...item, role: undefined } : item));
  }
  const idx = findSavedIndex(current, clean.lat, clean.lon);
  let next;
  if (idx >= 0) {
    const merged = { ...current[idx], ...clean, role: clean.role || current[idx].role };
    if (!merged.role) delete merged.role;
    next = current.map((item, i) => (i === idx ? merged : item));
  } else {
    next = [clean, ...current].slice(0, SAVED_MAX);
  }
  writePlaces(storage, SAVED_KEY, next);
  return next;
}

export function setSavedPlaceRole(storage, index, role) {
  const current = loadPlaces(storage, SAVED_KEY, SAVED_MAX);
  if (index < 0 || index >= current.length) return current;
  const r = role === "home" || role === "work" ? role : "";
  const next = current.map((item, i) => {
    const copy = { ...item };
    if (r && copy.role === r && i !== index) delete copy.role;
    if (i === index) {
      if (r) copy.role = r;
      else delete copy.role;
    }
    return copy;
  });
  writePlaces(storage, SAVED_KEY, next);
  return next;
}

export function renameSavedPlace(storage, index, newName) {
  const current = loadPlaces(storage, SAVED_KEY, SAVED_MAX);
  if (index < 0 || index >= current.length) return current;
  const cleanName = sanitiseAvrcpName(String(newName || "").trim());
  if (!cleanName) return current;
  const next = current.map((item, i) => (i === index ? { ...item, name: cleanName } : item));
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

export function replaceSavedPlaces(storage, list) {
  const out = [];
  for (const item of Array.isArray(list) ? list : []) {
    const clean = normaliseEntry({ ...item, action: "N" });
    if (!clean || out.some(e => samePlace(e, clean))) continue;
    out.push(clean);
    if (out.length >= SAVED_MAX) break;
  }
  writePlaces(storage, SAVED_KEY, out);
  return out;
}

/* Trip Presets */
export function loadPresets(storage) {
  if (!storage) return [];
  try {
    const raw = storage.getItem(PRESETS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(p => p && typeof p.name === "string" && Array.isArray(p.stops) && p.stops.length > 0)
      .slice(0, PRESETS_MAX)
      .map(p => ({
        id: String(p.id || p.name),
        name: sanitiseAvrcpName(p.name),
        stops: p.stops.map(normaliseEntry).filter(Boolean).slice(0, 10),
        at: Number(p.at) || 0
      }))
      .filter(p => p.stops.length > 0);
  } catch {
    return [];
  }
}

export function savePreset(storage, name, stops, now = Date.now()) {
  const cleanName = sanitiseAvrcpName(String(name || "").trim() || "Trip preset");
  const cleanStops = (Array.isArray(stops) ? stops : []).map(normaliseEntry).filter(Boolean).slice(0, 10);
  if (!cleanStops.length) return loadPresets(storage);
  const current = loadPresets(storage).filter(p => p.name.toLowerCase() !== cleanName.toLowerCase());
  const next = [{ id: `preset-${now}`, name: cleanName, stops: cleanStops, at: now }, ...current].slice(0, PRESETS_MAX);
  writePlaces(storage, PRESETS_KEY, next);
  return next;
}

export function removePreset(storage, index) {
  const current = loadPresets(storage);
  if (index < 0 || index >= current.length) return current;
  const next = current.filter((_, i) => i !== index);
  writePlaces(storage, PRESETS_KEY, next);
  return next;
}

/* Synced Car State & Pending-Sync Snapshot */
export function defaultCarState() {
  return {
    version: "",
    regionIso: "",
    units: 0,
    imperial: false,
    learnHistory: true,
    clockValid: false,
    mapBbox: null,
    lastSyncAt: 0,
    lastLinkAt: 0,
    carPrefs: { ...DEFAULT_CAR_PREFS },
    snapshot: null, // { prefs, favourites: [{name,lat,lon}] }
    insights: null
  };
}

export function loadCarState(storage) {
  const base = defaultCarState();
  if (!storage) return base;
  try {
    const raw = storage.getItem(CAR_STATE_KEY);
    if (!raw) return base;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return base;
    return {
      ...base,
      ...parsed,
      carPrefs: normaliseCarPrefs(parsed.carPrefs || base.carPrefs),
      snapshot: parsed.snapshot && typeof parsed.snapshot === "object"
        ? {
            prefs: parsed.snapshot.prefs ? normaliseCarPrefs(parsed.snapshot.prefs) : null,
            favourites: Array.isArray(parsed.snapshot.favourites)
              ? parsed.snapshot.favourites.map(normaliseEntry).filter(Boolean)
              : []
          }
        : null
    };
  } catch {
    return base;
  }
}

export function saveCarState(storage, state) {
  if (!storage) return state;
  try { storage.setItem(CAR_STATE_KEY, JSON.stringify(state)); } catch { }
  return state;
}

/* 1-File JSON Backup & Restore */
export function buildBackupPayload(storage) {
  return {
    schema: "clioplay-link-backup-v1",
    exportedAt: new Date().toISOString(),
    savedPlaces: loadPlaces(storage, SAVED_KEY, SAVED_MAX),
    presets: loadPresets(storage),
    carPrefs: loadCarState(storage).carPrefs
  };
}

export function restoreBackupPayload(storage, rawText) {
  const parsed = typeof rawText === "string" ? JSON.parse(rawText) : rawText;
  if (!parsed || parsed.schema !== "clioplay-link-backup-v1") {
    throw new Error("Unsupported backup file");
  }
  const saved = Array.isArray(parsed.savedPlaces) ? replaceSavedPlaces(storage, parsed.savedPlaces) : loadPlaces(storage, SAVED_KEY, SAVED_MAX);
  let presets = loadPresets(storage);
  if (Array.isArray(parsed.presets)) {
    writePlaces(storage, PRESETS_KEY, parsed.presets.slice(0, PRESETS_MAX));
    presets = loadPresets(storage);
  }
  const carState = loadCarState(storage);
  if (parsed.carPrefs && typeof parsed.carPrefs === "object") {
    carState.carPrefs = normaliseCarPrefs(parsed.carPrefs);
    saveCarState(storage, carState);
  }
  return { savedPlaces: saved, presets, carState };
}
