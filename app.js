import { parseDestination, parseShareParams, sanitiseAvrcpName, validCoords } from "./parser.js";
import { expandMapLink } from "./short-links.js";
import {
  DEFAULT_CAR_PREFS, normaliseCarPrefs, diffCarPrefs, optimizeStops2Opt, formatDistance
} from "./protocol.js";
import {
  parseConnectQrUrl, isPointInMapBbox, computePendingSyncDelta
} from "./qr-sync.js";
import {
  RECENT_KEY, SAVED_KEY, RECENT_MAX, SAVED_MAX,
  storageAvailable, loadPlaces, recordRecent, clearRecents,
  findSavedIndex, savePlace, setSavedPlaceRole, renameSavedPlace, removeSavedPlace, replaceSavedPlaces,
  loadPresets, savePreset, removePreset,
  loadCarState, saveCarState, buildBackupPayload, restoreBackupPayload
} from "./places-store.js";
import {
  TRIP_MAX, loadTrip, saveTrip, clearTrip,
  loadParkedSpot, saveParkedSpot, clearParkedSpot
} from "./trip-store.js";
import { ClioTransport, mediaSupported } from "./transport.js";
import { QrScannerController } from "./qr-scanner.js";
import { ClioMiniMap } from "./mini-map.js";
import { renderTripRail } from "./trip-rail.js";
import { renderInsights } from "./insights.js";
import {
  LANGUAGES, LANGUAGE_LABELS, detectOsLanguage, languageForIndex, indexForLanguage,
  loadLanguage, getCurrentLanguage, t, applyTranslations
} from "./i18n.js";
import { initReleaseNotice, compareVersions } from "./release-notice.js";

const resolverEndpoint = document.querySelector('meta[name="map-link-resolver"]')?.content.trim() || "";
const $ = id => document.getElementById(id);

const ICONS = {
  send: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7Z"/></svg>`,
  wave: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.55a11 11 0 0 1 14.08 0M8.53 16.11a6 6 0 0 1 6.95 0M12 20h.01"/></svg>`,
  check: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`,
  bookmark: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16Z"/></svg>`,
  clock: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>`,
  park: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="4"/><path d="M10 16V8h3a2.5 2.5 0 0 1 0 5h-3"/></svg>`,
  home: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 10 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><path d="M9 22V12h6v10"/></svg>`,
  work: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/></svg>`,
  plus: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>`,
  up: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>`,
  down: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>`,
  close: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="m6 6 12 12M18 6 6 18"/></svg>`,
  trash: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2m-9 0 1 14h8l1-14"/></svg>`,
  edit: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`,
  route: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="19" r="3"/><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"/><circle cx="18" cy="5" r="3"/></svg>`
};

const canStore = storageAvailable();
const stored = (k, fb) => { try { return localStorage.getItem(k) ?? fb; } catch { return fb; } };
const remember = (k, v) => { try { localStorage.setItem(k, String(v)); } catch { } };

function nextSequence() {
  let n = (Number(stored("clp-seq", "0")) + 1) & 0xffff;
  if (!n) n = 1;
  remember("clp-seq", n);
  return n;
}

const state = {
  activeTab: "navigate",
  placesSubtab: "saved",
  savedPlaces: canStore ? loadPlaces(localStorage, SAVED_KEY, SAVED_MAX) : [],
  recentPlaces: canStore ? loadPlaces(localStorage, RECENT_KEY, RECENT_MAX) : [],
  presets: canStore ? loadPresets(localStorage) : [],
  tripStops: canStore ? loadTrip(localStorage) : [],
  parkedSpot: canStore ? loadParkedSpot(localStorage) : null,
  car: canStore ? loadCarState(localStorage) : loadCarState(null),
  sendAction: "N",
  legacySeconds: Number(stored("clp-send-seconds", "4")) || 4,
  forceLegacy: stored("clp-force-legacy", "0") === "1",
  onlineEnabled: stored("clp-online-enabled", "1") !== "0",
  appTheme: stored("clp-app-theme", "system"),
  appLang: stored("clp-app-lang", ""),
  phoneGps: null,
  gpsWatchId: null,
  passedStops: new Set(),
  currentProvider: "Destination",
  currentConfidence: "exact",
  shortDestination: null,
  activeLookup: null,
  searchLookup: null,
  sending: false,
  activeSendStopIndex: -1,
  completedSendIndices: new Set(),
  latestRelease: null,
  pendingConnectPing: false,
  overlayPins: []
};

let deferredInstall = null;
let parseTimer = null;
let searchTimer = null;
let toastTimer = null;
let sentResetTimer = null;
let miniMap = null;
let transport = null;
let scanner = null;

function isImperial() {
  if (state.car?.carPrefs?.units === 2) return true;
  if (state.car?.carPrefs?.units === 1) return false;
  return Boolean(state.car?.imperial);
}

function resolveDarkTheme() {
  if (state.appTheme === "dark") return true;
  if (state.appTheme === "light") return false;
  return window.matchMedia?.("(prefers-color-scheme: light)")?.matches ? false : true;
}

function applyTheme() {
  const dark = resolveDarkTheme();
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  const meta = $("themeColorMeta");
  if (meta) meta.content = dark ? "#041214" : "#eceeed";
  miniMap?.scheduleDraw();
}

function showToast(text, duration = 2600) {
  const el = $("appToast");
  if (!el) return;
  clearTimeout(toastTimer);
  el.textContent = text;
  el.hidden = false;
  toastTimer = setTimeout(() => { el.hidden = true; }, duration);
}

function setBtStatus(cls, text) {
  const pill = $("btStatusPill");
  const label = $("btStatusText");
  if (pill) pill.className = `status-pill ${cls}`;
  if (label) label.textContent = text;
}

function vibrate(p) {
  try { navigator.vibrate?.(p); } catch { }
}

function currentCoords() {
  const la = $("latInput").value.trim(), lo = $("lonInput").value.trim();
  if (!la || !lo) return null;
  const lat = Number(la), lon = Number(lo);
  return validCoords(lat, lon) ? { lat, lon } : null;
}

function switchTab(tab) {
  state.activeTab = tab;
  const map = { navigate: "viewNavigate", places: "viewPlaces", car: "viewCar" };
  const nav = { navigate: "navNavigate", places: "navPlaces", car: "navCar" };
  for (const k of Object.keys(map)) {
    const active = k === tab;
    $(map[k]).hidden = !active;
    $(nav[k]).classList.toggle("selected", active);
    $(nav[k]).setAttribute("aria-selected", String(active));
  }
  if (tab === "navigate") {
    requestAnimationFrame(() => miniMap?.resize());
  }
  window.scrollTo({ top: 0, behavior: "instant" });
}

/* ==================== Live Foreground-Only GPS Watch ==================== */
function startGpsWatch() {
  if (!("geolocation" in navigator) || state.gpsWatchId !== null) return;
  if (document.hidden) return;
  // Only start continuous watch automatically if a trip is active or user already granted location
  if (!state.tripStops.length && !state.phoneGps) return;
  try {
    state.gpsWatchId = navigator.geolocation.watchPosition(
      pos => {
        state.phoneGps = {
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          heading: Number.isFinite(pos.coords.heading) ? pos.coords.heading : null,
          accuracy: Number.isFinite(pos.coords.accuracy) ? Math.round(pos.coords.accuracy) : null
        };
        syncMiniMap(false);
        if (state.tripStops.length) renderTrip();
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 12000 }
    );
  } catch { }
}

function stopGpsWatch() {
  if (state.gpsWatchId !== null && "geolocation" in navigator) {
    try { navigator.geolocation.clearWatch(state.gpsWatchId); } catch { }
    state.gpsWatchId = null;
  }
}

function requestOneGpsFix() {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) {
      reject(new Error("Location unavailable"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      pos => resolve({
        lat: pos.coords.latitude,
        lon: pos.coords.longitude,
        heading: Number.isFinite(pos.coords.heading) ? pos.coords.heading : null,
        accuracy: Number.isFinite(pos.coords.accuracy) ? Math.round(pos.coords.accuracy) : null
      }),
      err => reject(new Error(err?.code === 1 ? "Location permission denied" : "Could not get GPS fix")),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 8000 }
    );
  });
}

/* ==================== Mini-Map Sync ==================== */
function syncMiniMap(fit = false) {
  const coords = currentCoords();
  const hasAny = Boolean(coords || state.tripStops.length || state.overlayPins.length);
  $("miniMapCard").hidden = !hasAny;
  if (!hasAny || !miniMap) return;
  miniMap.resize();
  miniMap.setState({
    pin: coords ? { lat: coords.lat, lon: coords.lon, name: $("nameInput").value.trim(), draggable: true } : null,
    stops: state.tripStops,
    phoneGps: state.phoneGps,
    overlayPins: state.overlayPins,
    mapBbox: state.car.mapBbox,
    fit
  });
}

/* ==================== Omnibox: Local + Free OSM Search + Link Parser ==================== */
function setMessage(text, tone = "") {
  const el = $("parseMessage");
  el.textContent = text;
  el.className = `message${tone ? ` ${tone}` : ""}`;
}

function hideSearchResults() {
  $("searchResults").hidden = true;
  $("searchResults").replaceChildren();
}

function looksLikeUrlOrCoords(raw) {
  const s = raw.trim();
  if (!s) return false;
  if (/https?:\/\/|^geo:|maps\.app\.goo\.gl|goo\.gl|apple\.com|comaps\.at|waze\.com|osm\.org|openstreetmap/i.test(s)) return true;
  if (/^-?\d{1,3}(?:\.\d+)?\s*[°,\s]\s*[NSns]?\s*[,\s]\s*-?\d{1,3}(?:\.\d+)?/.test(s)) return true;
  return false;
}

function localSearchMatches(query) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits = [];
  if (state.parkedSpot && state.parkedSpot.name.toLowerCase().includes(q)) {
    hits.push({ tag: t("parked_title"), name: state.parkedSpot.name, sub: `${state.parkedSpot.lat.toFixed(4)}, ${state.parkedSpot.lon.toFixed(4)}`, lat: state.parkedSpot.lat, lon: state.parkedSpot.lon });
  }
  for (const p of state.savedPlaces) {
    if (p.name.toLowerCase().includes(q) || (p.role && p.role.includes(q))) {
      hits.push({ tag: t("subtab_saved"), name: p.name, sub: `${p.lat.toFixed(4)}, ${p.lon.toFixed(4)}`, lat: p.lat, lon: p.lon });
    }
  }
  for (const p of state.recentPlaces) {
    if (p.name.toLowerCase().includes(q) && !hits.some(h => Math.abs(h.lat - p.lat) < 0.0001 && Math.abs(h.lon - p.lon) < 0.0001)) {
      hits.push({ tag: t("subtab_recent"), name: p.name, sub: `${p.lat.toFixed(4)}, ${p.lon.toFixed(4)}`, lat: p.lat, lon: p.lon });
    }
  }
  return hits.slice(0, 4);
}

function renderSearchResults(items) {
  const ul = $("searchResults");
  if (!items.length) {
    hideSearchResults();
    return;
  }
  ul.replaceChildren();
  for (const item of items) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "search-result-btn";
    const tag = document.createElement("span");
    tag.className = "search-result-tag";
    tag.textContent = item.tag;
    const copy = document.createElement("span");
    copy.className = "search-result-copy";
    const st = document.createElement("strong");
    st.textContent = item.name;
    const sm = document.createElement("small");
    sm.textContent = item.sub;
    copy.append(st, sm);
    btn.append(tag, copy);
    btn.addEventListener("click", () => {
      hideSearchResults();
      loadDestination(item.lat, item.lon, item.name, item.tag, "exact");
    });
    li.appendChild(btn);
    ul.appendChild(li);
  }
  ul.hidden = false;
}

async function queryOnlinePlaces(query) {
  state.searchLookup?.abort();
  const localHits = localSearchMatches(query);
  if (localHits.length) renderSearchResults(localHits);

  if (!state.onlineEnabled || (typeof navigator !== "undefined" && navigator.onLine === false)) {
    if (!localHits.length) setMessage(t("search_offline_hint"));
    return;
  }
  if (query.trim().length < 3) return;

  const ctrl = new AbortController();
  state.searchLookup = ctrl;
  $("expandSpinner").hidden = false;
  setMessage(t("search_searching"));

  const biasLat = state.phoneGps?.lat ?? (state.car.mapBbox ? (state.car.mapBbox.minLat + state.car.mapBbox.maxLat) / 2 : null);
  const biasLon = state.phoneGps?.lon ?? (state.car.mapBbox ? (state.car.mapBbox.minLon + state.car.mapBbox.maxLon) / 2 : null);

  let results = [];
  try {
    // 1. Free OSM Photon geocoder (no API key, fast typo-tolerant autocomplete)
    const params = new URLSearchParams({ q: query.trim(), limit: "6" });
    if (biasLat !== null && biasLon !== null) {
      params.set("lat", biasLat.toFixed(4));
      params.set("lon", biasLon.toFixed(4));
    }
    const r = await fetch(`https://photon.komoot.io/api/?${params}`, { signal: ctrl.signal });
    if (r.ok) {
      const data = await r.json();
      for (const feat of data.features || []) {
        const [lon, lat] = feat.geometry?.coordinates || [];
        if (!validCoords(lat, lon)) continue;
        const p = feat.properties || {};
        const name = p.name || p.street || p.city || "Place";
        const sub = [p.street, p.city || p.town || p.county, p.country].filter(Boolean).join(", ");
        results.push({ tag: "OSM", name, sub: sub || `${lat.toFixed(4)}, ${lon.toFixed(4)}`, lat, lon });
      }
    }
  } catch { }

  if (!results.length && !ctrl.signal.aborted) {
    try {
      // 2. Nominatim fallback
      const params = new URLSearchParams({ q: query.trim(), format: "jsonv2", limit: "5" });
      const r = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, { signal: ctrl.signal });
      if (r.ok) {
        const rows = await r.json();
        for (const row of rows || []) {
          const lat = Number(row.lat), lon = Number(row.lon);
          if (!validCoords(lat, lon)) continue;
          const parts = String(row.display_name || "").split(",").map(s => s.trim());
          results.push({ tag: "OSM", name: row.name || parts[0] || "Place", sub: parts.slice(1, 4).join(", "), lat, lon });
        }
      }
    } catch { }
  }

  if (state.searchLookup === ctrl) {
    state.searchLookup = null;
    $("expandSpinner").hidden = true;
    const combined = [...localHits, ...results].slice(0, 7);
    if (combined.length) {
      renderSearchResults(combined);
      setMessage(t(state.tripStops.length ? "prompt_idle_trip" : "prompt_idle"));
    } else {
      hideSearchResults();
      setMessage(t("search_no_results"), "warning");
    }
  }
}

function resetShortLink() {
  state.activeLookup?.abort();
  state.activeLookup = null;
  state.shortDestination = null;
  $("expandSpinner").hidden = true;
  $("shortLinkActions").hidden = true;
  $("openShortLink").removeAttribute("href");
  $("expandLink").disabled = false;
}

async function resolveShortDestination() {
  if (!state.shortDestination || !resolverEndpoint || state.activeLookup) return;
  const source = state.shortDestination;
  const ctrl = new AbortController();
  state.activeLookup = ctrl;
  const timer = setTimeout(() => ctrl.abort(), 9500);
  $("expandSpinner").hidden = false;
  $("expandLink").disabled = true;
  $("shortLinkActions").hidden = true;
  try {
    const expanded = await expandMapLink(source.shortLink, resolverEndpoint, ctrl.signal);
    if (state.activeLookup !== ctrl) return;
    const parsed = parseDestination(expanded);
    if (parsed.ok) {
      resetShortLink();
      loadDestination(parsed.lat, parsed.lon, parsed.name || source.sharedName || "Phone destination", parsed.provider, parsed.confidence);
    } else {
      $("openShortLink").href = expanded;
      $("shortLinkActions").hidden = false;
      setMessage(parsed.error, "error");
    }
  } catch {
    if (state.activeLookup === ctrl) {
      $("shortLinkActions").hidden = false;
      setMessage("Could not expand short link.", "error");
    }
  } finally {
    clearTimeout(timer);
    if (state.activeLookup === ctrl) {
      state.activeLookup = null;
      $("expandSpinner").hidden = true;
      $("expandLink").disabled = false;
    }
  }
}

function handleOmniboxInput() {
  clearTimeout(parseTimer);
  clearTimeout(searchTimer);
  resetShortLink();
  const raw = $("destinationInput").value.trim();
  $("clearInputButton").hidden = !raw && !currentCoords();

  if (!raw) {
    hideSearchResults();
    clearDestination();
    setMessage(t(state.tripStops.length ? "prompt_idle_trip" : "prompt_idle"));
    return;
  }

  // Check if user pasted a ClioPlay Connect QR URL directly!
  const conn = parseConnectQrUrl(raw);
  if (conn) {
    $("destinationInput").value = "";
    applyConnectQr(conn);
    return;
  }

  // Try deterministic link/coordinate parser first
  const parsed = parseDestination(raw);
  if (parsed.ok) {
    hideSearchResults();
    loadDestination(parsed.lat, parsed.lon, parsed.name || "Phone destination", parsed.provider, parsed.confidence);
    return;
  }
  if (parsed.shortLink) {
    hideSearchResults();
    clearDestination();
    state.shortDestination = parsed;
    $("openShortLink").href = parsed.shortLink;
    $("expandLink").hidden = !resolverEndpoint;
    if (resolverEndpoint && state.onlineEnabled) {
      resolveShortDestination();
    } else {
      $("shortLinkActions").hidden = false;
      setMessage(parsed.error || "Tap Expand to resolve short link.");
    }
    return;
  }

  if (looksLikeUrlOrCoords(raw)) {
    hideSearchResults();
    clearDestination();
    setMessage(parsed.error, "error");
    return;
  }

  // Otherwise treat as a live place search!
  const localHits = localSearchMatches(raw);
  if (localHits.length) renderSearchResults(localHits);
  else hideSearchResults();
  searchTimer = setTimeout(() => queryOnlinePlaces(raw), 320);
}

/* ==================== Active Destination & Map Coverage Check ==================== */
function loadDestination(lat, lon, name, provider = "Destination", confidence = "exact") {
  $("latInput").value = Number(lat).toFixed(6);
  $("lonInput").value = Number(lon).toFixed(6);
  $("nameInput").value = name || "Phone destination";
  state.currentProvider = provider;
  state.currentConfidence = confidence;
  state.overlayPins = [];
  updateDestinationCard();
  syncMiniMap(true);
  setMessage(`${provider} · ${Number(lat).toFixed(5)}, ${Number(lon).toFixed(5)}`, "success");
}

function clearDestination() {
  $("latInput").value = "";
  $("lonInput").value = "";
  $("nameInput").value = "";
  $("destinationCard").hidden = true;
  $("outOfMapBanner").hidden = true;
  $("clearInputButton").hidden = !$("destinationInput").value.trim();
  updateSendDock();
  renderQuickPlaces();
  syncMiniMap(false);
}

function updateDestinationCard() {
  const coords = currentCoords();
  $("clearInputButton").hidden = !coords && !$("destinationInput").value.trim();
  if (!coords) {
    $("destinationCard").hidden = true;
    $("outOfMapBanner").hidden = true;
    updateSendDock();
    renderQuickPlaces();
    return;
  }

  const name = $("nameInput").value.trim() || "Phone destination";
  $("sourceReadout").textContent = state.currentProvider;
  $("previewName").textContent = name;
  $("previewCoords").textContent = `${coords.lat.toFixed(6)}, ${coords.lon.toFixed(6)}`;

  const badge = $("confidenceBadge");
  if (state.currentConfidence === "exact") {
    badge.textContent = "Exact";
    badge.className = "confidence-tag exact";
    badge.hidden = false;
  } else {
    badge.textContent = "Check pin";
    badge.className = "confidence-tag warn";
    badge.hidden = false;
  }

  // Pre-drive Out-of-Map Check against car's synced mapBbox!
  const inside = isPointInMapBbox(coords.lat, coords.lon, state.car.mapBbox);
  $("outOfMapBanner").hidden = inside;

  // Name counter (40 chars / 160 UTF-8 bytes)
  const cp = [...name.normalize("NFC")].length;
  const bytes = new TextEncoder().encode(name.normalize("NFC")).length;
  $("nameCounter").textContent = `${cp} / 40`;
  $("nameCounter").classList.toggle("over", cp > 40 || bytes > 160);

  // Bookmark button
  const savedIdx = findSavedIndex(state.savedPlaces, coords.lat, coords.lon);
  const saveBtn = $("savePlaceButton");
  saveBtn.hidden = !canStore;
  saveBtn.classList.toggle("saved", savedIdx >= 0);
  $("savePlaceLabel").textContent = savedIdx >= 0 ? t("btn_saved") : t("btn_save");

  // Add to trip button
  const full = state.tripStops.length >= TRIP_MAX;
  $("addToTripButton").disabled = state.sending || full;
  $("addToTripLabel").textContent = full
    ? t("btn_trip_full")
    : (state.tripStops.length ? t("btn_add_stop_n", { n: state.tripStops.length + 1 }) : t("btn_start_trip"));

  $("destinationCard").hidden = false;
  updateSendDock();
  renderQuickPlaces();
}

/* ==================== Quick Places, Trip Rail & Send Dock ==================== */
function renderQuickPlaces() {
  const hasDest = Boolean(currentCoords());
  const strip = $("quickPlacesStrip");
  const listEl = $("quickPlacesList");
  const items = [];
  if (state.parkedSpot) items.push({ kind: "parked", item: state.parkedSpot });
  const home = state.savedPlaces.find(p => p.role === "home");
  const work = state.savedPlaces.find(p => p.role === "work");
  if (home) items.push({ kind: "home", item: home });
  if (work) items.push({ kind: "work", item: work });
  for (const p of state.savedPlaces) {
    if (p === home || p === work) continue;
    items.push({ kind: "saved", item: p });
    if (items.length >= 6) break;
  }
  for (const p of state.recentPlaces) {
    if (items.length >= 6) break;
    if (findSavedIndex(state.savedPlaces, p.lat, p.lon) >= 0) continue;
    items.push({ kind: "recent", item: p });
  }
  if (hasDest || !items.length) {
    strip.hidden = true;
    return;
  }
  listEl.replaceChildren();
  for (const entry of items) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `quick-chip ${entry.kind}`;
    const icon = state.tripStops.length
      ? ICONS.plus
      : (entry.kind === "parked" ? ICONS.park : entry.kind === "home" ? ICONS.home : entry.kind === "work" ? ICONS.work : entry.kind === "saved" ? ICONS.bookmark : ICONS.clock);
    btn.innerHTML = icon;
    const span = document.createElement("span");
    span.textContent = entry.item.name;
    btn.appendChild(span);
    btn.addEventListener("click", () => {
      if (state.tripStops.length) {
        enqueueTripStop(entry.item);
      } else {
        loadDestination(entry.item.lat, entry.item.lon, entry.item.name, entry.kind === "parked" ? t("parked_title") : t("subtab_saved"));
      }
    });
    listEl.appendChild(btn);
  }
  strip.hidden = false;
}

function persistTrip() {
  if (canStore) saveTrip(localStorage, state.tripStops);
}

function enqueueTripStop(stop, { clearComposer = false } = {}) {
  if (state.tripStops.length >= TRIP_MAX) {
    showToast(t("btn_trip_full"));
    return false;
  }
  const lat = Number(stop.lat), lon = Number(stop.lon);
  if (!validCoords(lat, lon)) return false;
  state.tripStops = [...state.tripStops, {
    name: sanitiseAvrcpName(stop.name || "Phone destination"),
    lat: Number(lat.toFixed(6)),
    lon: Number(lon.toFixed(6)),
    ...(stop.legDistM ? { legDistM: stop.legDistM } : {}),
    ...(stop.legDurS ? { legDurS: stop.legDurS } : {})
  }];
  persistTrip();
  if (clearComposer) {
    $("destinationInput").value = "";
    clearDestination();
  }
  startGpsWatch();
  renderTrip();
  syncMiniMap(true);
  vibrate(10);
  return true;
}

function renderTrip() {
  const card = $("tripCard");
  if (!state.tripStops.length) {
    card.hidden = true;
    state.passedStops.clear();
    updateDestinationCard();
    updateSendDock();
    syncMiniMap(false);
    return;
  }
  card.hidden = false;
  $("tripCountPill").textContent = `${state.tripStops.length} / ${TRIP_MAX}`;
  $("optimiseTripButton").hidden = state.tripStops.length < 3 || state.sending;
  $("savePresetButton").disabled = state.sending;
  $("clearTripButton").disabled = state.sending;

  const prog = renderTripRail($("tripList"), {
    stops: state.tripStops,
    phoneGps: state.phoneGps,
    passedIndices: state.passedStops,
    sending: state.sending,
    activeSendStopIndex: state.activeSendStopIndex,
    completedSendIndices: state.completedSendIndices,
    imperial: isImperial(),
    t,
    icons: ICONS,
    onSelectStop: (_idx, stop) => {
      miniMap?.focusPoint(stop.lat, stop.lon, 15.5);
    },
    onMoveStop: (idx, delta) => {
      const target = idx + delta;
      if (state.sending || target < 0 || target >= state.tripStops.length) return;
      const copy = state.tripStops.slice();
      [copy[idx], copy[target]] = [copy[target], copy[idx]];
      state.tripStops = copy;
      state.passedStops.clear();
      persistTrip();
      renderTrip();
      syncMiniMap(false);
      vibrate(8);
    },
    onRemoveStop: idx => {
      if (state.sending) return;
      state.tripStops = state.tripStops.filter((_, i) => i !== idx);
      state.passedStops.clear();
      persistTrip();
      renderTrip();
      syncMiniMap(true);
    }
  });
  state.passedStops = prog.passedIndices;
  updateSendDock();
  renderQuickPlaces();
}

function updateSendDock() {
  const isTrip = state.tripStops.length > 0;
  $("actionSection").hidden = isTrip;
  const btn = $("sendButton");
  btn.classList.toggle("trip-mode", isTrip);

  // Show compact remote car controls whenever CLP3 link was seen or car has been synced
  const linked = Boolean(transport?.clp3Confirmed || state.car.lastSyncAt || state.car.lastLinkAt);
  $("remoteStrip").hidden = !linked || state.sending;

  if (state.sending || btn.classList.contains("sent")) return;

  const supported = mediaSupported();
  $("sendDurationBadge").textContent = state.forceLegacy
    ? `${isTrip ? state.tripStops.length * state.legacySeconds : state.legacySeconds}s`
    : "CLP3";

  if (isTrip) {
    btn.disabled = !supported;
    $("sendLabel").textContent = state.tripStops.length === 1
      ? t("send_to_car")
      : t("send_trip_n", { n: state.tripStops.length });
    $("sendSubtext").textContent = supported ? t("send_instant_ready") : t("status_unsupported");
  } else {
    const coords = currentCoords();
    btn.disabled = !coords || !supported;
    $("sendLabel").textContent = t("send_to_car");
    $("sendSubtext").textContent = !coords
      ? t("send_choose_first")
      : (supported ? t("send_instant_ready") : t("status_unsupported"));
  }
}

function setSendAction(action) {
  state.sendAction = action === "S" ? "S" : "N";
  const isNew = state.sendAction === "N";
  $("routeNewButton").classList.toggle("selected", isNew);
  $("addStopButton").classList.toggle("selected", !isNew);
  $("routeNewButton").setAttribute("aria-pressed", String(isNew));
  $("addStopButton").setAttribute("aria-pressed", String(!isNew));
}

/* ==================== CLP3 Transmission Actions ==================== */
function showSendComplete(label, subtext) {
  const btn = $("sendButton");
  btn.classList.remove("sending");
  btn.classList.add("sent");
  $("sendProgressFill").style.width = "100%";
  $("sendIcon").innerHTML = ICONS.check;
  $("sendLabel").textContent = label;
  $("sendSubtext").textContent = subtext;
  setBtStatus("linked", t("status_sent"));
  vibrate([14, 36, 14]);
  clearTimeout(sentResetTimer);
  sentResetTimer = setTimeout(() => {
    btn.classList.remove("sent");
    $("sendProgressFill").style.width = "0%";
    $("sendIcon").innerHTML = ICONS.send;
    state.completedSendIndices.clear();
    setBtStatus(transport?.clp3Confirmed ? "linked" : "ready", transport?.clp3Confirmed ? t("status_linked") : t("status_ready"));
    renderTrip();
    updateSendDock();
  }, 2400);
}

async function handleSend() {
  if (state.sending || !transport || !mediaSupported()) return;
  const isTrip = state.tripStops.length > 0;
  const coords = currentCoords();
  if (!isTrip && !coords) return;

  state.sending = true;
  state.activeSendStopIndex = -1;
  state.completedSendIndices.clear();
  clearTimeout(sentResetTimer);

  const btn = $("sendButton");
  btn.disabled = true;
  btn.classList.remove("sent");
  btn.classList.add("sending");
  $("sendIcon").innerHTML = ICONS.wave;
  $("sendProgressFill").style.width = "10%";
  $("sendLabel").textContent = t("send_sending");
  $("cancelTripButton").hidden = !isTrip;
  setBtStatus("sending", t("status_sending"));
  vibrate(12);

  try {
    if (isTrip) {
      const res = await transport.sendTrip(state.tripStops, {
        onStep: (stepIdx, total, stopIdx, phase) => {
          if (phase === "sending") {
            state.activeSendStopIndex = stopIdx;
            $("sendProgressFill").style.width = `${Math.round(((stepIdx + 0.35) / total) * 100)}%`;
            $("sendSubtext").textContent = `${stepIdx + 1} / ${total} · ${state.tripStops[stopIdx]?.name || ""}`;
          } else if (phase === "done") {
            state.completedSendIndices.add(stopIdx);
            $("sendProgressFill").style.width = `${Math.round(((stepIdx + 1) / total) * 100)}%`;
          }
          renderTrip();
        }
      });
      state.sending = false;
      state.activeSendStopIndex = -1;
      $("cancelTripButton").hidden = true;
      if (res.ok) {
        if (canStore) {
          const last = state.tripStops[state.tripStops.length - 1];
          state.recentPlaces = recordRecent(localStorage, { ...last, action: "N" });
          state.car.lastLinkAt = Date.now();
          saveCarState(localStorage, state.car);
          renderPlaces();
          renderCarTab();
        }
        showSendComplete(t("send_confirmed"), `${state.tripStops.length} ${t("trip_heading")}`);
      } else if (res.status === "nack") {
        btn.classList.remove("sending");
        $("sendIcon").innerHTML = ICONS.send;
        $("sendProgressFill").style.width = "0%";
        showToast(t("send_out_of_map"), 3600);
        setBtStatus("error", t("status_ready"));
        updateSendDock();
      } else {
        btn.classList.remove("sending");
        $("sendIcon").innerHTML = ICONS.send;
        $("sendProgressFill").style.width = "0%";
        setBtStatus("ready", t("status_ready"));
        updateSendDock();
      }
    } else {
      const name = $("nameInput").value.trim() || "Phone destination";
      const res = await transport.sendDestination(coords.lat, coords.lon, name, state.sendAction, {
        onProgress: pct => { $("sendProgressFill").style.width = `${pct.toFixed(0)}%`; }
      });
      state.sending = false;
      if (res.ok) {
        if (canStore) {
          state.recentPlaces = recordRecent(localStorage, { name, lat: coords.lat, lon: coords.lon, action: state.sendAction });
          if (res.status === "ack") {
            state.car.lastLinkAt = Date.now();
            saveCarState(localStorage, state.car);
          }
          renderPlaces();
          renderCarTab();
        }
        showSendComplete(
          t("send_confirmed"),
          res.status === "ack" ? t("send_confirmed_rtt", { ms: res.rttMs }) : t("status_sent")
        );
      } else if (res.status === "nack") {
        btn.classList.remove("sending");
        $("sendIcon").innerHTML = ICONS.send;
        $("sendProgressFill").style.width = "0%";
        showToast(t("send_out_of_map"), 3600);
        setBtStatus("error", t("status_ready"));
        updateSendDock();
      } else {
        btn.classList.remove("sending");
        $("sendIcon").innerHTML = ICONS.send;
        $("sendProgressFill").style.width = "0%";
        setBtStatus("ready", t("status_ready"));
        updateSendDock();
      }
    }
  } catch (err) {
    state.sending = false;
    $("cancelTripButton").hidden = true;
    btn.classList.remove("sending");
    $("sendIcon").innerHTML = ICONS.send;
    $("sendProgressFill").style.width = "0%";
    setBtStatus("ready", t("status_ready"));
    updateSendDock();
    showToast(err?.message || "Bluetooth transfer failed");
  }
}

/* ==================== Places Tab & Pending-Sync Delta ==================== */
function getDelta() {
  return computePendingSyncDelta(
    { savedPlaces: state.savedPlaces, carPrefs: state.car.carPrefs },
    state.car.snapshot
  );
}

function updatePendingBadges() {
  const delta = getDelta();
  const hasSnapshot = Boolean(state.car.snapshot);
  const placePending = hasSnapshot ? delta.unsyncedPlaceCount : state.savedPlaces.length;

  // Places sync button label
  $("syncPlacesToCarLabel").textContent = placePending > 0
    ? t("btn_sync_to_car", { n: placePending })
    : t("btn_sync_to_car_clean");

  // Places bottom tab badge
  const pBadge = $("placesBadge");
  if (hasSnapshot && delta.unsyncedPlaceCount > 0) {
    pBadge.textContent = String(delta.unsyncedPlaceCount);
    pBadge.className = "nav-badge warn";
    pBadge.hidden = false;
  } else {
    pBadge.hidden = true;
  }

  // Car bottom tab badge (settings pending or car update available)
  const cBadge = $("carBadge");
  const updateAvail = Boolean(
    state.latestRelease && state.car.version &&
    compareVersions(state.latestRelease.version, state.car.version) > 0
  );
  if (hasSnapshot && delta.totalChanges > 0) {
    cBadge.textContent = String(delta.totalChanges);
    cBadge.hidden = false;
  } else if (updateAvail) {
    cBadge.textContent = "!";
    cBadge.hidden = false;
  } else {
    cBadge.hidden = true;
  }
}

function renderParked() {
  const spot = state.parkedSpot;
  $("parkHereButton").hidden = !("geolocation" in navigator);
  if (!spot) {
    $("parkedTitle").textContent = t("parked_title");
    $("parkedMeta").textContent = t("parked_empty");
    $("walkBackLink").hidden = true;
    $("loadParkedButton").hidden = true;
    $("clearParkedButton").hidden = true;
    return;
  }
  $("parkedTitle").textContent = spot.name || t("parked_title");
  const distStr = state.phoneGps ? `${formatDistance(
    Math.hypot(spot.lat - state.phoneGps.lat, (spot.lon - state.phoneGps.lon) * Math.cos(spot.lat * Math.PI / 180)) * 111320,
    isImperial()
  )} · ` : "";
  const when = spot.at ? new Date(spot.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
  $("parkedMeta").textContent = `${distStr}${when} · ${spot.lat.toFixed(5)}, ${spot.lon.toFixed(5)}`;
  // Walking directions back to the parked car in OS default map app
  const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent);
  $("walkBackLink").href = isIos
    ? `https://maps.apple.com/?daddr=${spot.lat},${spot.lon}&dirflg=w`
    : `https://www.google.com/maps/dir/?api=1&destination=${spot.lat},${spot.lon}&travelmode=walking`;
  $("walkBackLink").hidden = false;
  $("loadParkedButton").hidden = false;
  $("clearParkedButton").hidden = false;
}

function renderPlaces() {
  renderParked();
  const delta = getDelta();
  const hasSnapshot = Boolean(state.car.snapshot);

  // Pinned Home & Work
  const home = state.savedPlaces.find(p => p.role === "home");
  const work = state.savedPlaces.find(p => p.role === "work");
  $("pinnedHomeSub").textContent = home ? home.name : t("pin_set_hint");
  $("pinnedWorkSub").textContent = work ? work.name : t("pin_set_hint");

  // Sub-tabs
  const tabs = [
    ["saved", $("savedTabButton"), state.savedPlaces.length],
    ["presets", $("presetsTabButton"), state.presets.length],
    ["recent", $("recentTabButton"), state.recentPlaces.length]
  ];
  for (const [k, btn, cnt] of tabs) {
    const active = state.placesSubtab === k;
    btn.classList.toggle("selected", active);
    btn.setAttribute("aria-selected", String(active));
    const base = t(`subtab_${k}`);
    btn.textContent = cnt ? `${base} (${cnt})` : base;
  }
  $("clearRecentsButton").hidden = state.placesSubtab !== "recent" || !state.recentPlaces.length;

  const ul = $("placesList");
  const emptyEl = $("placesEmpty");
  ul.replaceChildren();

  if (state.placesSubtab === "presets") {
    if (!state.presets.length) {
      emptyEl.hidden = false;
      $("placesEmptyTitle").textContent = t("empty_presets");
      $("placesEmptyText").textContent = "";
      updatePendingBadges();
      return;
    }
    emptyEl.hidden = true;
    state.presets.forEach((preset, idx) => {
      const li = document.createElement("li");
      li.className = "place-row";
      const loadBtn = document.createElement("button");
      loadBtn.type = "button";
      loadBtn.className = "place-load";
      loadBtn.innerHTML = `<span class="place-avatar">${ICONS.route}</span>`;
      const txt = document.createElement("span");
      txt.className = "place-text";
      const strong = document.createElement("strong");
      strong.textContent = preset.name;
      const small = document.createElement("small");
      small.textContent = preset.stops.map(s => s.name).join(" → ");
      txt.append(strong, small);
      loadBtn.appendChild(txt);
      loadBtn.addEventListener("click", () => {
        state.tripStops = preset.stops.map(s => ({ ...s }));
        persistTrip();
        startGpsWatch();
        renderTrip();
        syncMiniMap(true);
        switchTab("navigate");
        showToast(preset.name);
      });
      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "place-icon-btn danger";
      delBtn.innerHTML = ICONS.trash;
      delBtn.addEventListener("click", () => {
        state.presets = removePreset(localStorage, idx);
        renderPlaces();
      });
      li.append(loadBtn, delBtn);
      ul.appendChild(li);
    });
    updatePendingBadges();
    return;
  }

  const isSaved = state.placesSubtab === "saved";
  const list = isSaved ? state.savedPlaces : state.recentPlaces;
  if (!list.length) {
    emptyEl.hidden = false;
    $("placesEmptyTitle").textContent = isSaved ? t("empty_saved") : t("empty_recent");
    $("placesEmptyText").textContent = "";
    updatePendingBadges();
    return;
  }
  emptyEl.hidden = true;

  list.forEach((item, idx) => {
    const li = document.createElement("li");
    li.className = "place-row";

    const loadBtn = document.createElement("button");
    loadBtn.type = "button";
    loadBtn.className = "place-load";
    const av = document.createElement("span");
    av.className = `place-avatar${isSaved ? "" : " recent"}`;
    av.innerHTML = item.role === "home" ? ICONS.home : item.role === "work" ? ICONS.work : (isSaved ? ICONS.bookmark : ICONS.clock);

    const txt = document.createElement("span");
    txt.className = "place-text";
    const titleLine = document.createElement("span");
    titleLine.className = "place-title-line";
    const strong = document.createElement("strong");
    strong.textContent = item.name;
    titleLine.appendChild(strong);
    if (isSaved && hasSnapshot && !delta.isPlaceSynced(item)) {
      const badge = document.createElement("span");
      badge.className = "phone-only-dot";
      badge.textContent = t("badge_phone_only");
      titleLine.appendChild(badge);
    }
    const small = document.createElement("small");
    small.textContent = `${item.lat.toFixed(5)}, ${item.lon.toFixed(5)}`;
    txt.append(titleLine, small);
    loadBtn.append(av, txt);
    loadBtn.addEventListener("click", () => {
      loadDestination(item.lat, item.lon, item.name, isSaved ? t("subtab_saved") : t("subtab_recent"));
      switchTab("navigate");
    });

    const acts = document.createElement("div");
    acts.className = "place-actions";

    const addTripBtn = document.createElement("button");
    addTripBtn.type = "button";
    addTripBtn.className = "place-icon-btn";
    addTripBtn.innerHTML = ICONS.plus;
    addTripBtn.title = t("action_add_stop");
    addTripBtn.addEventListener("click", () => {
      enqueueTripStop(item);
      showToast(item.name);
    });
    acts.appendChild(addTripBtn);

    if (isSaved) {
      const renameBtn = document.createElement("button");
      renameBtn.type = "button";
      renameBtn.className = "place-icon-btn";
      renameBtn.innerHTML = ICONS.edit;
      renameBtn.addEventListener("click", () => {
        const next = prompt(t("label_car_name"), item.name);
        if (next && next.trim()) {
          state.savedPlaces = renameSavedPlace(localStorage, idx, next.trim());
          renderPlaces();
          renderCarTab();
        }
      });
      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "place-icon-btn danger";
      delBtn.innerHTML = ICONS.trash;
      delBtn.addEventListener("click", () => {
        state.savedPlaces = removeSavedPlace(localStorage, idx);
        updateDestinationCard();
        renderPlaces();
        renderCarTab();
      });
      acts.append(renameBtn, delBtn);
    } else {
      const savedIdx = findSavedIndex(state.savedPlaces, item.lat, item.lon);
      const saveBtn = document.createElement("button");
      saveBtn.type = "button";
      saveBtn.className = `place-icon-btn${savedIdx >= 0 ? " saved" : ""}`;
      saveBtn.innerHTML = ICONS.bookmark;
      saveBtn.addEventListener("click", () => {
        const i = findSavedIndex(state.savedPlaces, item.lat, item.lon);
        state.savedPlaces = i >= 0
          ? removeSavedPlace(localStorage, i)
          : savePlace(localStorage, item);
        renderPlaces();
        renderCarTab();
      });
      acts.appendChild(saveBtn);
    }

    li.append(loadBtn, acts);
    ul.appendChild(li);
  });

  updatePendingBadges();
  renderQuickPlaces();
}

/* ==================== Car Tab: Hero, Insights, 18-Field Settings ==================== */
function minsToTimeInput(mins) {
  const m = Math.max(0, Math.min(1439, Math.round(Number(mins) || 0)));
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}
function timeInputToMins(str, fallback) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(str || ""));
  if (!m) return fallback;
  const h = Number(m[1]), mn = Number(m[2]);
  return (h >= 0 && h < 24 && mn >= 0 && mn < 60) ? (h * 60 + mn) : fallback;
}

function populateLanguageSelects() {
  for (const id of ["prefLanguage", "appLanguageSelect"]) {
    const sel = $(id);
    if (!sel) continue;
    sel.replaceChildren();
    LANGUAGES.forEach((code, idx) => {
      const opt = document.createElement("option");
      opt.value = id === "prefLanguage" ? String(idx) : code;
      opt.textContent = LANGUAGE_LABELS[code] || code;
      sel.appendChild(opt);
    });
  }
}

function renderCarTab() {
  const car = state.car;
  const p = normaliseCarPrefs(car.carPrefs);
  const delta = getDelta();

  // 1. Hero card
  const badge = $("carVersionBadge");
  if (car.version) {
    const parts = [`v${car.version}`];
    if (car.regionIso) parts.push(car.regionIso);
    parts.push(isImperial() ? "mi" : "km");
    if (car.lastSyncAt) {
      parts.push(new Date(car.lastSyncAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
    }
    $("carHeroSubtitle").textContent = parts.join(" · ");

    const updateAvail = state.latestRelease && compareVersions(state.latestRelease.version, car.version) > 0;
    badge.hidden = false;
    badge.className = `value-pill ${updateAvail ? "warn" : "ok"}`;
    badge.textContent = updateAvail
      ? t("update_available", { ver: state.latestRelease.version })
      : t("up_to_date");
  } else {
    $("carHeroSubtitle").textContent = t("car_not_synced");
    badge.hidden = true;
  }

  // Calm pending-sync strip
  const strip = $("carSyncStatusStrip");
  if (car.snapshot) {
    strip.hidden = false;
    if (delta.totalChanges === 0) {
      strip.className = "sync-status-strip synced";
      $("carSyncStatusText").textContent = t("car_in_sync");
      $("carQuickSyncBtn").hidden = true;
    } else {
      strip.className = "sync-status-strip dirty";
      $("carSyncStatusText").textContent = t("car_pending_changes", { n: delta.totalChanges });
      $("carQuickSyncBtn").textContent = t("btn_sync_to_car", { n: delta.totalChanges });
      $("carQuickSyncBtn").hidden = false;
    }
  } else {
    strip.hidden = true;
  }

  // 2. Driving Insights
  renderInsights($("insightsContainer"), car.insights, {
    imperial: isImperial(),
    t,
    onPickPoint: pt => {
      state.overlayPins = [{ lat: pt.lat, lon: pt.lon, label: pt.name, kind: pt.kind }];
      loadDestination(pt.lat, pt.lon, pt.name, t("insights_heading"));
      switchTab("navigate");
    }
  });

  // 3. 18-Field Car Settings Controls
  $("prefBright").value = String(p.bright);
  $("prefBrightVal").textContent = `${p.bright}%`;
  $("prefTheme").value = String(p.theme);
  $("prefDayStart").value = minsToTimeInput(p.dayStart);
  $("prefNightStart").value = minsToTimeInput(p.nightStart);
  $("prefUnits").value = String(p.units);
  $("prefCameras").value = String(p.cameras);
  $("prefNavChimes").value = String(p.navChimes);
  $("prefLanguage").value = String(p.language);
  $("prefAutozoom").setAttribute("aria-checked", String(p.autozoom));
  $("prefClockAuto").setAttribute("aria-checked", String(p.clockAuto));
  $("prefGpsHud").setAttribute("aria-checked", String(p.gpsHud));
  $("prefTopSwap").setAttribute("aria-checked", String(p.topSwap));
  $("prefBottomSwap").setAttribute("aria-checked", String(p.bottomSwap));
  $("prefLearnHistory").setAttribute("aria-checked", String(p.learnHistory));
  $("prefDestPred").setAttribute("aria-checked", String(p.destPred));
  $("prefDiversions").setAttribute("aria-checked", String(p.diversions));
  $("prefDebug").setAttribute("aria-checked", String(p.debug));

  // Highlight modified setting rows + show sticky apply bar
  const changedSet = new Set(delta.changedPrefKeys);
  for (const row of document.querySelectorAll("[data-pref-key]")) {
    row.classList.toggle("modified", changedSet.has(row.dataset.prefKey));
  }
  const stickyBar = $("stickyApplyBar");
  const showApply = car.snapshot ? changedSet.size > 0 : false;
  stickyBar.hidden = !showApply;
  if (showApply) {
    $("applyCarPrefsBtn").textContent = t("apply_changes_car", { n: changedSet.size });
  }

  // 4. App Preferences
  $("appThemeSelect").value = state.appTheme;
  $("appLanguageSelect").value = getCurrentLanguage();
  $("onlineFeaturesToggle").setAttribute("aria-checked", String(state.onlineEnabled));
  $("forceLegacyToggle").setAttribute("aria-checked", String(state.forceLegacy));
  for (const b of $("durationPills").querySelectorAll("[data-duration]")) {
    b.classList.toggle("selected", Number(b.dataset.duration) === state.legacySeconds);
  }

  updatePendingBadges();
}

function updateCarPref(key, value) {
  state.car.carPrefs = normaliseCarPrefs({ ...state.car.carPrefs, [key]: value });
  // Ensure snapshot exists so user sees sticky Apply bar even before first car QR sync!
  if (!state.car.snapshot) {
    state.car.snapshot = { prefs: { ...DEFAULT_CAR_PREFS }, favourites: [] };
  }
  saveCarState(localStorage, state.car);
  renderCarTab();
}

async function pushPendingDelta({ placesOnly = false, prefsOnly = false, fullRestore = false } = {}) {
  if (!transport || !mediaSupported()) {
    showToast(t("status_unsupported"));
    return;
  }
  const delta = getDelta();
  const faveOps = [];
  if (fullRestore) {
    for (const p of state.savedPlaces) {
      faveOps.push({ op: p.role === "home" ? 1 : p.role === "work" ? 2 : 0, place: p });
    }
  } else if (!prefsOnly) {
    if (state.car.snapshot) {
      for (const item of delta.toAddOrRename) faveOps.push(item);
      for (const item of delta.toDelete) faveOps.push(item);
    } else {
      for (const p of state.savedPlaces) {
        faveOps.push({ op: p.role === "home" ? 1 : p.role === "work" ? 2 : 0, place: p });
      }
    }
  }
  const sendPrefs = fullRestore || (!placesOnly && (delta.prefsDirty || prefsOnly));
  if (!faveOps.length && !sendPrefs) {
    showToast(t("car_in_sync"));
    return;
  }

  setBtStatus("sending", t("status_sending"));
  const res = await transport.syncChanges({
    faveOps,
    clearAllFaves: fullRestore,
    prefs: sendPrefs ? state.car.carPrefs : null,
    onProgress: (done, tot) => setBtStatus("sending", `${done}/${tot}`)
  });
  if (res.ok) {
    state.car.lastLinkAt = Date.now();
    state.car.snapshot = {
      prefs: sendPrefs ? normaliseCarPrefs(state.car.carPrefs) : (state.car.snapshot?.prefs || normaliseCarPrefs(state.car.carPrefs)),
      favourites: (!prefsOnly || fullRestore)
        ? state.savedPlaces.map(p => ({ name: p.name, lat: p.lat, lon: p.lon }))
        : (state.car.snapshot?.favourites || [])
    };
    saveCarState(localStorage, state.car);
    setBtStatus("linked", t("status_linked"));
    renderPlaces();
    renderCarTab();
    showToast(t("scanner_synced"));
    vibrate([12, 30, 12]);
  } else {
    setBtStatus("ready", t("status_ready"));
    showToast("Could not reach ClioPlay over Bluetooth");
  }
}

/* ==================== Optical QR Connect & Sync Bundle Merge ==================== */
function applyConnectQr(conn) {
  state.car.version = conn.version;
  state.car.regionIso = conn.regionIso || state.car.regionIso;
  state.car.units = conn.units;
  state.car.imperial = conn.imperial;
  if (conn.mapBbox) state.car.mapBbox = conn.mapBbox;
  state.car.lastSyncAt = Date.now();
  saveCarState(localStorage, state.car);
  renderCarTab();
  updateDestinationCard();
  syncMiniMap(false);
  showToast(`ClioPlay v${conn.version}${conn.regionIso ? ` · ${conn.regionIso}` : ""}`);
  // Queue silent CLP3:H Ping on first tap (or immediately if user-gesture triggered via scanner)
  state.pendingConnectPing = true;
}

async function applySyncBundle(bundle) {
  state.car.version = bundle.version;
  state.car.regionIso = bundle.regionIso || state.car.regionIso;
  state.car.imperial = bundle.imperial;
  state.car.learnHistory = bundle.learnHistory;
  state.car.clockValid = bundle.clockValid;
  state.car.mapBbox = bundle.mapBbox;
  state.car.lastSyncAt = Date.now();
  state.car.carPrefs = normaliseCarPrefs(bundle.prefs);
  state.car.insights = bundle.insights;
  state.car.snapshot = {
    prefs: normaliseCarPrefs(bundle.prefs),
    favourites: bundle.favourites.map(f => ({ name: f.name, lat: f.lat, lon: f.lon }))
  };
  saveCarState(localStorage, state.car);

  // Merge car favourites into phone Saved (preserving phone-only places + Home/Work roles)
  if (canStore && bundle.favourites.length) {
    let next = state.savedPlaces.slice();
    for (const cf of bundle.favourites) {
      const idx = findSavedIndex(next, cf.lat, cf.lon);
      if (idx >= 0) next[idx] = { ...next[idx], name: cf.name };
      else next.push({ name: cf.name, lat: cf.lat, lon: cf.lon, action: "N", at: Date.now() });
    }
    state.savedPlaces = replaceSavedPlaces(localStorage, next);
  }
  // Merge recents
  if (canStore && bundle.recents.length) {
    for (const r of bundle.recents.slice().reverse()) {
      state.recentPlaces = recordRecent(localStorage, r);
    }
  }
  // Load car's Active Trip onto the live itinerary rail!
  if (bundle.activeTrip?.stops?.length) {
    state.tripStops = bundle.activeTrip.stops.map(s => ({ ...s }));
    state.passedStops.clear();
    persistTrip();
    startGpsWatch();
  }
  // Auto-match app language if user hasn't explicitly overridden it
  if (!state.appLang && Number.isInteger(bundle.prefs?.language)) {
    const carLang = languageForIndex(bundle.prefs.language);
    await loadLanguage(carLang);
    applyTranslations();
  }

  renderTrip();
  renderPlaces();
  renderCarTab();
  syncMiniMap(true);
  setBtStatus("linked", t("status_linked"));
  showToast(t("scanner_synced"), 3200);
}

/* ==================== Event Wiring & Initialisation ==================== */
function setupOsShareCards() {
  const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const isAndroid = /Android/i.test(navigator.userAgent);
  $("iosShareCard").hidden = isAndroid && !isIos;
  $("androidShareCard").hidden = isIos;
  const base = location.protocol === "https:" && !/^(localhost|127\.0\.0\.1)$/i.test(location.hostname)
    ? `${location.origin}${location.pathname}?text=`
    : "https://pxwel-dev.github.io/ClioPlay-Send/?text=";
  $("shortcutUrlPreview").textContent = base;
}

function handleIncomingUrlParams() {
  // 1. Connect QR deep-link hash (`#q=C1...`) from native phone camera!
  if (location.hash && location.hash.includes("q=C1.")) {
    const conn = parseConnectQrUrl(location.hash);
    if (conn) {
      applyConnectQr(conn);
      history.replaceState(null, "", location.pathname + location.search);
    }
  }
  // 2. Web Share Target / iOS Shortcut query params (`?text=...` / `?lat=...&lon=...`)
  const shared = parseShareParams(location.search);
  if (!shared) return;
  history.replaceState(null, "", location.pathname);
  if (shared.action) setSendAction(shared.action);
  if (shared.kind === "coords") {
    if (shared.addToTrip) enqueueTripStop({ name: shared.name, lat: shared.lat, lon: shared.lon });
    else loadDestination(shared.lat, shared.lon, shared.name || "Shared location", "Shared");
  } else if (shared.kind === "text") {
    $("destinationInput").value = shared.text;
    handleOmniboxInput();
  }
}

async function init() {
  applyTheme();
  populateLanguageSelects();
  setupOsShareCards();

  // Language init: explicit preference -> synced car language -> OS language
  const initialLang = state.appLang ||
    (state.car.lastSyncAt ? languageForIndex(state.car.carPrefs.language) : detectOsLanguage());
  await loadLanguage(initialLang);
  applyTranslations();

  // Core controllers
  transport = new ClioTransport({
    audioEl: $("txAudio"),
    nextSeq: nextSequence,
    getLegacySeconds: () => state.legacySeconds,
    getForceLegacy: () => state.forceLegacy
  });

  miniMap = new ClioMiniMap($("miniMapCanvas"), {
    isOnlineAllowed: () => state.onlineEnabled,
    isDarkTheme: () => resolveDarkTheme(),
    onPinMoved: (lat, lon) => {
      $("latInput").value = lat.toFixed(6);
      $("lonInput").value = lon.toFixed(6);
      updateDestinationCard();
      vibrate(8);
    },
    onSelectOverlay: pt => {
      loadDestination(pt.lat, pt.lon, pt.label || "Place", t("insights_heading"));
    }
  });

  scanner = new QrScannerController({
    modalEl: $("scannerModal"),
    videoEl: $("scannerVideo"),
    canvasEl: $("scannerCanvas"),
    statusEl: $("scannerStatus"),
    dotsEl: $("scannerDots"),
    closeBtn: $("scannerCloseBtn"),
    transport,
    t,
    onConnect: conn => {
      applyConnectQr(conn);
      transport.ping().catch(() => {});
    },
    onSyncBundle: bundle => { applySyncBundle(bundle); }
  });

  // Smart Release Notice (only banners when newer than synced car version!)
  initReleaseNotice({
    getSyncedVersion: () => state.car.version || "",
    onReleaseLoaded: data => {
      state.latestRelease = data;
      renderCarTab();
    }
  });

  // Tab bar
  $("navNavigate").addEventListener("click", () => switchTab("navigate"));
  $("navPlaces").addEventListener("click", () => switchTab("places"));
  $("navCar").addEventListener("click", () => switchTab("car"));

  // Top status pill -> quick Test Link Ping
  $("btStatusPill").addEventListener("click", async () => {
    setBtStatus("sending", t("status_sending"));
    const res = await transport.ping();
    if (res.ok) {
      state.car.lastLinkAt = Date.now();
      saveCarState(localStorage, state.car);
      setBtStatus("linked", `${res.rttMs} ms`);
      showToast(t("send_confirmed_rtt", { ms: res.rttMs }));
      updateSendDock();
    } else {
      setBtStatus("ready", t("status_ready"));
      showToast("No ClioPlay v3.0 reply (check Bluetooth)");
    }
  });

  // Silent CLP3:H Ping on first tap after scanning Connect QR from native phone camera (auto-closes P_PAIR!)
  document.addEventListener("pointerdown", () => {
    if (state.pendingConnectPing && !transport.busy) {
      state.pendingConnectPing = false;
      transport.ping().then(r => {
        if (r.ok) setBtStatus("linked", t("status_linked"));
      }).catch(() => {});
    }
  }, { passive: true });

  // Omnibox & Coords
  $("destinationInput").addEventListener("input", () => {
    clearTimeout(parseTimer);
    parseTimer = setTimeout(handleOmniboxInput, 180);
  });
  $("pasteButton").addEventListener("click", async () => {
    try {
      const txt = await navigator.clipboard.readText();
      if (txt) {
        $("destinationInput").value = txt;
        handleOmniboxInput();
      }
    } catch {
      $("destinationInput").focus();
      showToast("Tap inside box and paste");
    }
  });
  $("locateButton").addEventListener("click", async () => {
    $("expandSpinner").hidden = false;
    try {
      const fix = await requestOneGpsFix();
      state.phoneGps = fix;
      startGpsWatch();
      loadDestination(fix.lat, fix.lon, t("btn_locate"), "GPS");
    } catch (err) {
      showToast(err?.message || "GPS unavailable");
    } finally {
      $("expandSpinner").hidden = true;
    }
  });
  $("manualCoordsToggle").addEventListener("click", () => {
    const p = $("manualCoordsPanel");
    p.hidden = !p.hidden;
    $("manualCoordsToggle").setAttribute("aria-expanded", String(!p.hidden));
  });
  const onManualCoord = () => {
    const c = currentCoords();
    if (c) {
      state.currentProvider = "Coordinates";
      state.currentConfidence = "exact";
      updateDestinationCard();
      syncMiniMap(true);
    }
  };
  $("latInput").addEventListener("input", onManualCoord);
  $("lonInput").addEventListener("input", onManualCoord);
  $("clearInputButton").addEventListener("click", () => {
    $("destinationInput").value = "";
    hideSearchResults();
    resetShortLink();
    clearDestination();
  });
  $("expandLink").addEventListener("click", resolveShortDestination);
  $("mapFitButton").addEventListener("click", () => syncMiniMap(true));

  // Destination card actions
  $("nameInput").addEventListener("input", updateDestinationCard);
  $("savePlaceButton").addEventListener("click", () => {
    const c = currentCoords();
    if (!c || !canStore) return;
    const idx = findSavedIndex(state.savedPlaces, c.lat, c.lon);
    if (idx >= 0) {
      state.savedPlaces = removeSavedPlace(localStorage, idx);
    } else {
      state.savedPlaces = savePlace(localStorage, { name: $("nameInput").value.trim() || "Saved place", lat: c.lat, lon: c.lon });
    }
    updateDestinationCard();
    renderPlaces();
    renderCarTab();
    vibrate(10);
  });
  $("addToTripButton").addEventListener("click", () => {
    const c = currentCoords();
    if (!c) return;
    enqueueTripStop({ name: $("nameInput").value.trim() || "Stop", lat: c.lat, lon: c.lon }, { clearComposer: true });
  });

  // Trip rail actions
  $("optimiseTripButton").addEventListener("click", () => {
    state.tripStops = optimizeStops2Opt(state.tripStops, { origin: state.phoneGps, keepFinalFixed: true });
    persistTrip();
    renderTrip();
    syncMiniMap(true);
    vibrate(12);
    showToast(t("trip_optimise"));
  });
  $("savePresetButton").addEventListener("click", () => {
    if (!state.tripStops.length || !canStore) return;
    const defName = `${state.tripStops[0].name} → ${state.tripStops[state.tripStops.length - 1].name}`;
    const name = prompt(t("trip_save_preset"), defName);
    if (!name || !name.trim()) return;
    state.presets = savePreset(localStorage, name.trim(), state.tripStops);
    renderPlaces();
    showToast(t("btn_saved"));
  });
  $("clearTripButton").addEventListener("click", () => {
    state.tripStops = clearTrip(localStorage);
    state.passedStops.clear();
    renderTrip();
    syncMiniMap(false);
  });

  // Action switch & Send dock
  $("routeNewButton").addEventListener("click", () => setSendAction("N"));
  $("addStopButton").addEventListener("click", () => setSendAction("S"));
  $("sendButton").addEventListener("click", handleSend);
  $("cancelTripButton").addEventListener("click", () => transport.cancel());
  $("remoteCancelRouteBtn").addEventListener("click", async () => {
    const res = await transport.sendControl("cancel");
    showToast(res.ok ? t("remote_cancel_route") : "No reply from car");
  });
  $("remoteSkipStopBtn").addEventListener("click", async () => {
    const res = await transport.sendControl("skip");
    showToast(res.ok ? t("remote_skip_stop") : "No next stop");
  });

  // Places tab controls
  $("syncPlacesToCarBtn").addEventListener("click", () => pushPendingDelta({ placesOnly: true }));
  $("syncPlacesFromCarBtn").addEventListener("click", () => scanner.open({ triggerCarPill: true }));
  $("parkHereButton").addEventListener("click", async () => {
    try {
      const fix = await requestOneGpsFix();
      state.phoneGps = fix;
      state.parkedSpot = saveParkedSpot(localStorage, { name: t("parked_title"), ...fix });
      renderPlaces();
      vibrate([10, 25, 10]);
      showToast(t("btn_saved"));
    } catch (err) {
      showToast(err?.message || "GPS unavailable");
    }
  });
  $("loadParkedButton").addEventListener("click", () => {
    if (!state.parkedSpot) return;
    loadDestination(state.parkedSpot.lat, state.parkedSpot.lon, state.parkedSpot.name, t("parked_title"));
    switchTab("navigate");
  });
  $("clearParkedButton").addEventListener("click", () => {
    state.parkedSpot = clearParkedSpot(localStorage);
    renderPlaces();
  });

  const handlePinnedCard = role => {
    const existing = state.savedPlaces.find(p => p.role === role);
    if (existing) {
      loadDestination(existing.lat, existing.lon, existing.name, role === "home" ? t("pin_home") : t("pin_work"));
      switchTab("navigate");
      return;
    }
    if (!state.savedPlaces.length) {
      showToast(t("empty_saved"));
      return;
    }
    const choices = state.savedPlaces.map((p, i) => `${i + 1}. ${p.name}`).join("\n");
    const pick = prompt(`${t(role === "home" ? "pin_home" : "pin_work")}:\n${choices}`, "1");
    const idx = Number(pick) - 1;
    if (Number.isInteger(idx) && idx >= 0 && idx < state.savedPlaces.length) {
      state.savedPlaces = setSavedPlaceRole(localStorage, idx, role);
      renderPlaces();
    }
  };
  $("pinnedHomeBtn").addEventListener("click", () => handlePinnedCard("home"));
  $("pinnedWorkBtn").addEventListener("click", () => handlePinnedCard("work"));

  $("savedTabButton").addEventListener("click", () => { state.placesSubtab = "saved"; renderPlaces(); });
  $("presetsTabButton").addEventListener("click", () => { state.placesSubtab = "presets"; renderPlaces(); });
  $("recentTabButton").addEventListener("click", () => { state.placesSubtab = "recent"; renderPlaces(); });
  $("clearRecentsButton").addEventListener("click", () => {
    state.recentPlaces = clearRecents(localStorage);
    renderPlaces();
  });

  // Car tab actions
  $("carSyncFromBtn").addEventListener("click", () => scanner.open({ triggerCarPill: true }));
  $("carQuickSyncBtn").addEventListener("click", () => pushPendingDelta());
  $("pingCarBtn").addEventListener("click", () => $("btStatusPill").click());
  $("scanConnectQrBtn").addEventListener("click", () => scanner.open({ triggerCarPill: false }));
  $("syncClockBtn").addEventListener("click", async () => {
    const res = await transport.sendControl("clock");
    showToast(res.ok ? t("btn_sync_clock") + " ✓" : "No reply from car");
  });

  // 18-Field Car Settings bindings
  $("prefBright").addEventListener("input", e => updateCarPref("bright", Number(e.target.value)));
  $("prefTheme").addEventListener("change", e => updateCarPref("theme", Number(e.target.value)));
  $("prefDayStart").addEventListener("change", e => updateCarPref("dayStart", timeInputToMins(e.target.value, 420)));
  $("prefNightStart").addEventListener("change", e => updateCarPref("nightStart", timeInputToMins(e.target.value, 1200)));
  $("prefUnits").addEventListener("change", e => { updateCarPref("units", Number(e.target.value)); renderTrip(); });
  $("prefCameras").addEventListener("change", e => updateCarPref("cameras", Number(e.target.value)));
  $("prefNavChimes").addEventListener("change", e => updateCarPref("navChimes", Number(e.target.value)));
  $("prefLanguage").addEventListener("change", e => updateCarPref("language", Number(e.target.value)));

  const toggleBindings = [
    ["prefAutozoom", "autozoom"], ["prefClockAuto", "clockAuto"], ["prefGpsHud", "gpsHud"],
    ["prefTopSwap", "topSwap"], ["prefBottomSwap", "bottomSwap"], ["prefLearnHistory", "learnHistory"],
    ["prefDestPred", "destPred"], ["prefDiversions", "diversions"], ["prefDebug", "debug"]
  ];
  for (const [id, key] of toggleBindings) {
    $(id).addEventListener("click", () => updateCarPref(key, !state.car.carPrefs[key]));
  }
  $("applyCarPrefsBtn").addEventListener("click", () => pushPendingDelta({ prefsOnly: true }));
  $("resetCarPrefsBtn").addEventListener("click", () => {
    if (state.car.snapshot?.prefs) {
      state.car.carPrefs = normaliseCarPrefs(state.car.snapshot.prefs);
      saveCarState(localStorage, state.car);
      renderCarTab();
    }
  });
  $("restoreFullProfileBtn").addEventListener("click", () => pushPendingDelta({ fullRestore: true }));

  // App Preferences
  $("appThemeSelect").addEventListener("change", e => {
    state.appTheme = e.target.value;
    remember("clp-app-theme", state.appTheme);
    applyTheme();
  });
  window.matchMedia?.("(prefers-color-scheme: light)")?.addEventListener("change", applyTheme);

  $("appLanguageSelect").addEventListener("change", async e => {
    state.appLang = e.target.value;
    remember("clp-app-lang", state.appLang);
    await loadLanguage(state.appLang);
    applyTranslations();
    renderTrip();
    renderPlaces();
    renderCarTab();
    updateDestinationCard();
    updateSendDock();
  });

  $("onlineFeaturesToggle").addEventListener("click", () => {
    state.onlineEnabled = !state.onlineEnabled;
    remember("clp-online-enabled", state.onlineEnabled ? "1" : "0");
    renderCarTab();
    miniMap?.scheduleDraw();
  });

  // 1-File JSON Backup & Restore
  $("exportBackupBtn").addEventListener("click", () => {
    const payload = buildBackupPayload(localStorage);
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `clioplay-link-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    showToast(t("btn_export_backup") + " ✓");
  });
  $("importBackupBtn").addEventListener("click", () => $("importBackupInput").click());
  $("importBackupInput").addEventListener("change", async e => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const txt = await file.text();
      const restored = restoreBackupPayload(localStorage, txt);
      state.savedPlaces = restored.savedPlaces;
      state.presets = restored.presets;
      state.car = restored.carState;
      renderPlaces();
      renderCarTab();
      showToast(t("btn_import_backup") + " ✓");
    } catch {
      showToast("Invalid backup JSON");
    }
    e.target.value = "";
  });

  // Share setup & v2.2 legacy controls
  $("copyShortcutUrlButton").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText($("shortcutUrlPreview").textContent);
      showToast(t("btn_copy") + " ✓");
    } catch { }
  });
  $("forceLegacyToggle").addEventListener("click", () => {
    state.forceLegacy = !state.forceLegacy;
    remember("clp-force-legacy", state.forceLegacy ? "1" : "0");
    renderCarTab();
    updateSendDock();
  });
  $("durationPills").addEventListener("click", e => {
    const b = e.target.closest("[data-duration]");
    if (!b) return;
    state.legacySeconds = Number(b.dataset.duration) || 4;
    remember("clp-send-seconds", state.legacySeconds);
    renderCarTab();
    updateSendDock();
  });

  // PWA Install prompt + Service Worker
  window.addEventListener("beforeinstallprompt", e => {
    e.preventDefault();
    deferredInstall = e;
    $("installButton").hidden = false;
  });
  $("installButton").addEventListener("click", async () => {
    if (!deferredInstall) return;
    deferredInstall.prompt();
    await deferredInstall.userChoice;
    deferredInstall = null;
    $("installButton").hidden = true;
  });
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }

  // Pause GPS watch immediately when backgrounded to preserve phone battery
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopGpsWatch();
    else startGpsWatch();
  });

  // Initial renders & URL ingest
  renderTrip();
  renderPlaces();
  renderCarTab();
  updateDestinationCard();
  syncMiniMap(true);
  handleIncomingUrlParams();
  startGpsWatch();
}

init();
