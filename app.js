import { parseDestination, parseShareParams, buildPacket, sanitiseAvrcpName, validCoords } from "./parser.js?v=20261126-5";
import { expandMapLink } from "./short-links.js?v=20261126";
import {
  RECENT_KEY, SAVED_KEY, RECENT_MAX, SAVED_MAX,
  storageAvailable, loadPlaces, recordRecent, clearRecents,
  findSavedIndex, savePlace, removeSavedPlace
} from "./places-store.js?v=20261126-5";
import {
  TRIP_MAX, loadTrip, saveTrip, clearTrip,
  buildTripPackets, loadParkedSpot, saveParkedSpot, clearParkedSpot
} from "./trip-store.js?v=20261126-7";

const resolverEndpoint = document.querySelector('meta[name="map-link-resolver"]')?.content.trim();
const $ = id => document.getElementById(id);

const ICONS = {
  send: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7Z"/></svg>`,
  wave: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.55a11 11 0 0 1 14.08 0M8.53 16.11a6 6 0 0 1 6.95 0M12 20h.01"/></svg>`,
  check: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`,
  bookmark: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16Z"/></svg>`,
  clock: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>`,
  park: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="4"/><path d="M10 16V8h3a2.5 2.5 0 0 1 0 5h-3"/></svg>`,
  plus: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>`,
  up: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>`,
  down: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>`,
  close: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="m6 6 12 12M18 6 6 18"/></svg>`,
  trash: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2m-9 0 1 14h8l1-14"/></svg>`
};

const ALLOWED_DURATIONS = [1, 2, 3, 4, 5, 8];

const el = {
  installButton: $("installButton"),
  settingsInstallButton: $("settingsInstallButton"),
  installedBadge: $("installedBadge"),
  installStatusTitle: $("installStatusTitle"),
  installStatusText: $("installStatusText"),
  btStatusPill: $("btStatusPill"),
  btStatusText: $("btStatusText"),
  viewSend: $("viewSend"),
  viewPlaces: $("viewPlaces"),
  viewSettings: $("viewSettings"),
  navSend: $("navSend"),
  navPlaces: $("navPlaces"),
  navSettings: $("navSettings"),
  placesBadge: $("placesBadge"),
  locateButton: $("locateButton"),
  manualCoordsToggle: $("manualCoordsToggle"),
  manualCoordsPanel: $("manualCoordsPanel"),
  clearInputButton: $("clearInputButton"),
  destinationInput: $("destinationInput"),
  pasteButton: $("pasteButton"),
  expandSpinner: $("expandSpinner"),
  parseMessage: $("parseMessage"),
  shortLinkActions: $("shortLinkActions"),
  expandLink: $("expandLink"),
  openShortLink: $("openShortLink"),
  quickPlacesStrip: $("quickPlacesStrip"),
  quickPlacesList: $("quickPlacesList"),
  quickPlacesAll: $("quickPlacesAll"),
  destinationCard: $("destinationCard"),
  sourceReadout: $("sourceReadout"),
  confidenceBadge: $("confidenceBadge"),
  previewName: $("previewName"),
  previewCoords: $("previewCoords"),
  savePlaceButton: $("savePlaceButton"),
  savePlaceLabel: $("savePlaceLabel"),
  nameInput: $("nameInput"),
  nameCounter: $("nameCounter"),
  addToTripButton: $("addToTripButton"),
  addToTripLabel: $("addToTripLabel"),
  tripCard: $("tripCard"),
  tripCountPill: $("tripCountPill"),
  clearTripButton: $("clearTripButton"),
  tripList: $("tripList"),
  cancelTripButton: $("cancelTripButton"),
  latInput: $("latInput"),
  lonInput: $("lonInput"),
  actionSection: $("actionSection"),
  routeNewButton: $("routeNewButton"),
  addStopButton: $("addStopButton"),
  sendButton: $("sendButton"),
  sendIcon: $("sendIcon"),
  sendLabel: $("sendLabel"),
  sendSubtext: $("sendSubtext"),
  sendDurationBadge: $("sendDurationBadge"),
  sendProgressFill: $("sendProgressFill"),
  parkedCard: $("parkedCard"),
  parkedTitle: $("parkedTitle"),
  parkedMeta: $("parkedMeta"),
  parkHereButton: $("parkHereButton"),
  loadParkedButton: $("loadParkedButton"),
  addParkedToTripButton: $("addParkedToTripButton"),
  clearParkedButton: $("clearParkedButton"),
  placesCard: $("placesCard"),
  savedTabButton: $("savedTabButton"),
  recentTabButton: $("recentTabButton"),
  clearRecentsButton: $("clearRecentsButton"),
  placesList: $("placesList"),
  placesEmpty: $("placesEmpty"),
  placesEmptyTitle: $("placesEmptyTitle"),
  placesEmptyText: $("placesEmptyText"),
  durationPills: $("durationPills"),
  durationValuePill: $("durationValuePill"),
  autoExpandToggle: $("autoExpandToggle"),
  shortcutUrlPreview: $("shortcutUrlPreview"),
  copyShortcutUrlButton: $("copyShortcutUrlButton"),
  releaseReopen: $("releaseReopen"),
  appToast: $("appToast"),
  txAudio: $("txAudio")
};

let deferredInstall = null;
let audioObjectUrl = null;
let parseTimer = null;
let shortDestination = null;
let activeLookup = null;
let pendingAddToTripAfterExpand = false;
let sendAction = "N";
let sendSeconds = 4;
let autoExpandEnabled = Boolean(resolverEndpoint);
let sending = false;
let sendingMode = ""; // "single" | "trip" | ""
let sendStartMs = 0;
let sendRafId = 0;
let sentTimer = null;
let tripStepTimer = null;
let activeTripSchedule = [];
let activeTripStep = -1;
let completedTripIndices = new Set();
let lastMovedTripIndex = -1;
let movedHighlightTimer = null;
let toastTimer = null;
let currentProvider = "Destination";
let currentConfidence = "exact";
const canStorePlaces = storageAvailable();
let savedPlaces = canStorePlaces ? loadPlaces(localStorage, SAVED_KEY, SAVED_MAX) : [];
let recentPlaces = canStorePlaces ? loadPlaces(localStorage, RECENT_KEY, RECENT_MAX) : [];
let tripStops = canStorePlaces ? loadTrip(localStorage) : [];
let parkedSpot = canStorePlaces ? loadParkedSpot(localStorage) : null;
let activePlacesTab = savedPlaces.length ? "saved" : "recent";
let activeMainTab = "send";
let pendingSentPlace = null;

function stored(key, fallback) {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}
function remember(key, value) {
  try { localStorage.setItem(key, value); } catch { }
}

function vibrate(pattern) {
  try { navigator.vibrate?.(pattern); } catch { }
}

function mediaSupported() {
  return "mediaSession" in navigator && "MediaMetadata" in window;
}

function geoSupported() {
  return "geolocation" in navigator;
}

function showToast(text) {
  if (!el.appToast) return;
  clearTimeout(toastTimer);
  el.appToast.textContent = text;
  el.appToast.hidden = false;
  toastTimer = setTimeout(() => { el.appToast.hidden = true; }, 2200);
}

function setBtStatus(state, label) {
  el.btStatusPill.className = `status-pill ${state}`;
  el.btStatusText.textContent = label;
}

function switchTab(tab) {
  activeMainTab = tab;
  const views = { send: el.viewSend, places: el.viewPlaces, settings: el.viewSettings };
  const buttons = { send: el.navSend, places: el.navPlaces, settings: el.navSettings };
  for (const key of Object.keys(views)) {
    const active = key === tab;
    views[key].hidden = !active;
    buttons[key].classList.toggle("selected", active);
    buttons[key].setAttribute("aria-selected", String(active));
  }
  window.scrollTo({ top: 0, behavior: "instant" });
}

function autoResizeInput() {
  el.destinationInput.style.height = "auto";
  const next = Math.min(Math.max(el.destinationInput.scrollHeight, 68), 150);
  el.destinationInput.style.height = `${next}px`;
}

function updateClearButton() {
  const hasContent = Boolean(
    el.destinationInput.value.trim() ||
    el.latInput.value.trim() ||
    el.lonInput.value.trim()
  );
  el.clearInputButton.hidden = !hasContent;
}

function setTransferDuration(seconds, persist = true) {
  sendSeconds = ALLOWED_DURATIONS.includes(seconds) ? seconds : 4;
  if (persist) remember("clp-send-seconds", String(sendSeconds));
  el.durationValuePill.textContent = `${sendSeconds}s`;
  for (const btn of el.durationPills.querySelectorAll("[data-duration]")) {
    const selected = Number(btn.dataset.duration) === sendSeconds;
    btn.classList.toggle("selected", selected);
    btn.setAttribute("aria-checked", String(selected));
  }
  updateSendDock();
}

function loadPreferences() {
  setTransferDuration(Number(stored("clp-send-seconds", "4")), false);
  if (!resolverEndpoint) {
    autoExpandEnabled = false;
    el.autoExpandToggle.disabled = true;
  } else {
    autoExpandEnabled = stored("clp-auto-expand", "1") !== "0";
  }
  el.autoExpandToggle.setAttribute("aria-checked", String(autoExpandEnabled));
}

function setMessage(text, type = "") {
  el.parseMessage.textContent = text;
  el.parseMessage.className = `message${type ? ` ${type}` : ""}`;
}

function nextSequence() {
  let n = Number(stored("clp-seq", "0"));
  n = (n + 1) & 0xffff;
  if (!n) n = 1;
  remember("clp-seq", String(n));
  return n;
}

function currentCoords() {
  if (!el.latInput.value.trim() || !el.lonInput.value.trim()) return null;
  const lat = Number(el.latInput.value), lon = Number(el.lonInput.value);
  return validCoords(lat, lon) ? { lat, lon } : null;
}

function updateNameCounter() {
  const value = el.nameInput.value.trim();
  const codePoints = [...value.normalize("NFC")].length;
  const bytes = new TextEncoder().encode(value.normalize("NFC")).length;
  const over = codePoints > 40 || bytes > 160;
  el.nameCounter.textContent = `${codePoints} / 40`;
  el.nameCounter.classList.toggle("over", over);
}

function updateSaveButton(coords) {
  if (!canStorePlaces || !coords) {
    el.savePlaceButton.hidden = true;
    return;
  }
  const idx = findSavedIndex(savedPlaces, coords.lat, coords.lon);
  const isSaved = idx >= 0;
  el.savePlaceButton.hidden = false;
  el.savePlaceButton.classList.toggle("saved", isSaved);
  el.savePlaceLabel.textContent = isSaved ? "Saved" : "Save";
  el.savePlaceButton.setAttribute("aria-pressed", String(isSaved));
}

function updateAddToTripButton() {
  const full = tripStops.length >= TRIP_MAX;
  el.addToTripButton.disabled = sending || full;
  el.addToTripButton.classList.toggle("primary", tripStops.length > 0 && !full);
  if (full) el.addToTripLabel.textContent = `Trip full (${TRIP_MAX} stops max)`;
  else if (tripStops.length > 0) el.addToTripLabel.textContent = `Add as stop ${tripStops.length + 1}`;
  else el.addToTripLabel.textContent = "Start multi-stop trip";
}

function updateSendDock() {
  const isTripMode = tripStops.length > 0;
  el.actionSection.hidden = isTripMode;
  el.sendButton.classList.toggle("trip-mode", isTripMode);

  if (sending || el.sendButton.classList.contains("sent")) return;

  if (isTripMode) {
    const totalSec = tripStops.length * sendSeconds;
    el.sendDurationBadge.textContent = `${totalSec}s`;
    el.sendButton.disabled = !mediaSupported();
    el.sendLabel.textContent = tripStops.length === 1
      ? "Send Trip to ClioPlay"
      : `Send Trip (${tripStops.length} stops)`;
    el.sendSubtext.textContent = !mediaSupported()
      ? "Browser not supported"
      : tripStops.length === 1
        ? `Add more stops above or send now · ${totalSec}s`
        : `${tripStops.length} stops · ${totalSec}s continuous transfer`;
  } else {
    const coords = currentCoords();
    el.sendDurationBadge.textContent = `${sendSeconds}s`;
    el.sendButton.disabled = !coords || !mediaSupported();
    el.sendLabel.textContent = "Send to ClioPlay";
    el.sendSubtext.textContent = !coords
      ? "Choose a destination first"
      : (mediaSupported() ? `Ready · ${sendSeconds}s Bluetooth window` : "Browser not supported");
  }
}

function updateConfidenceBadge(confidence) {
  currentConfidence = confidence || "exact";
  if (currentConfidence === "exact") {
    el.confidenceBadge.textContent = "Exact pin";
    el.confidenceBadge.className = "confidence-tag exact";
    el.confidenceBadge.hidden = false;
  } else if (currentConfidence === "map-center") {
    el.confidenceBadge.textContent = "Map centre";
    el.confidenceBadge.className = "confidence-tag warn";
    el.confidenceBadge.hidden = false;
  } else if (currentConfidence === "heuristic") {
    el.confidenceBadge.textContent = "Check pin";
    el.confidenceBadge.className = "confidence-tag warn";
    el.confidenceBadge.hidden = false;
  } else {
    el.confidenceBadge.hidden = true;
  }
}

function formatParkedTime(ts) {
  if (!ts) return "Saved spot";
  try {
    const d = new Date(ts);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    const hm = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    if (sameDay) return `Today at ${hm}`;
    const dm = d.toLocaleDateString([], { day: "numeric", month: "short" });
    return `${dm} at ${hm}`;
  } catch {
    return "Saved spot";
  }
}

function renderParked() {
  if (!geoSupported() && !parkedSpot) {
    el.parkedCard.hidden = true;
    return;
  }
  el.parkedCard.hidden = false;
  el.parkHereButton.hidden = !geoSupported();
  if (!parkedSpot) {
    el.parkedTitle.textContent = "Where I Parked";
    el.parkedMeta.textContent = "Save your current GPS location when you park.";
    el.parkHereButton.textContent = "Park here";
    el.loadParkedButton.hidden = true;
    el.addParkedToTripButton.hidden = true;
    el.clearParkedButton.hidden = true;
    return;
  }
  el.parkedTitle.textContent = parkedSpot.name || "Parked car";
  const acc = parkedSpot.accuracy !== null ? ` · ±${parkedSpot.accuracy} m` : "";
  el.parkedMeta.textContent = `${formatParkedTime(parkedSpot.at)}${acc} · ${parkedSpot.lat.toFixed(5)}, ${parkedSpot.lon.toFixed(5)}`;
  el.parkHereButton.textContent = "Update spot";
  el.loadParkedButton.hidden = false;
  el.addParkedToTripButton.hidden = false;
  el.clearParkedButton.hidden = false;
}

function renderQuickPlaces() {
  const hasDest = Boolean(currentCoords());
  if (hasDest || (!parkedSpot && (!canStorePlaces || (!savedPlaces.length && !recentPlaces.length)))) {
    el.quickPlacesStrip.hidden = true;
    return;
  }
  const combined = [];
  if (parkedSpot) {
    combined.push({ item: { ...parkedSpot, action: "N" }, kind: "parked" });
  }
  if (canStorePlaces) {
    for (const item of savedPlaces) {
      combined.push({ item, kind: "saved" });
      if (combined.length >= 5) break;
    }
    if (combined.length < 5) {
      for (const item of recentPlaces) {
        if (findSavedIndex(savedPlaces, item.lat, item.lon) >= 0) continue;
        combined.push({ item, kind: "recent" });
        if (combined.length >= 5) break;
      }
    }
  }
  const stripHeading = el.quickPlacesStrip.querySelector(".quick-strip-header span");
  if (stripHeading) stripHeading.textContent = tripStops.length > 0 ? "Quick add to trip" : "Quick places";
  el.quickPlacesList.replaceChildren();
  for (const entry of combined) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `quick-chip${entry.kind === "recent" ? " recent" : entry.kind === "parked" ? " parked" : ""}`;
    btn.innerHTML = tripStops.length > 0
      ? ICONS.plus
      : (entry.kind === "parked" ? ICONS.park : entry.kind === "saved" ? ICONS.bookmark : ICONS.clock);
    const span = document.createElement("span");
    span.textContent = entry.item.name;
    btn.appendChild(span);
    btn.addEventListener("click", () => {
      if (tripStops.length > 0) {
        enqueueTripStop({ name: entry.item.name, lat: entry.item.lat, lon: entry.item.lon });
      } else {
        const label = entry.kind === "parked" ? "Parked car" : entry.kind === "saved" ? "Saved place" : "Recent";
        loadQuickPlace(entry.item, label);
      }
    });
    el.quickPlacesList.appendChild(btn);
  }
  el.quickPlacesStrip.hidden = combined.length === 0;
}

function persistTrip() {
  if (canStorePlaces) saveTrip(localStorage, tripStops);
}

function enqueueTripStop(stop, { clearComposer = false } = {}) {
  if (tripStops.length >= TRIP_MAX) {
    showToast(`Trip full (max ${TRIP_MAX} stops)`);
    return false;
  }
  const lat = Number(stop.lat), lon = Number(stop.lon);
  if (!validCoords(lat, lon)) return false;
  const clean = {
    name: sanitiseAvrcpName(stop.name || "Phone destination"),
    lat: Number(lat.toFixed(6)),
    lon: Number(lon.toFixed(6))
  };
  tripStops = [...tripStops, clean];
  persistTrip();
  if (clearComposer) clearAllInputs();
  renderTrip();
  updateAddToTripButton();
  showToast(`Added to trip (${tripStops.length} ${tripStops.length === 1 ? "stop" : "stops"})`);
  return true;
}

function moveStopBy(index, delta, focusAction = "") {
  if (sending) return;
  const target = index + delta;
  if (index < 0 || index >= tripStops.length || target < 0 || target >= tripStops.length || index === target) return;
  tripStops = moveInMemory(tripStops, index, delta);
  persistTrip();
  lastMovedTripIndex = target;
  clearTimeout(movedHighlightTimer);
  movedHighlightTimer = setTimeout(() => { lastMovedTripIndex = -1; }, 450);
  vibrate(8);
  renderTrip();
  if (focusAction) {
    const nextBtn = el.tripList.querySelector(`button[data-trip-index="${target}"][data-trip-action="${focusAction}"]`);
    if (nextBtn && !nextBtn.disabled) nextBtn.focus({ preventScroll: true });
    else el.tripList.querySelector(`li[data-trip-index="${target}"]`)?.focus({ preventScroll: true });
  }
}

function removeStopAt(index) {
  if (sending || index < 0 || index >= tripStops.length) return;
  tripStops = tripStops.filter((_, idx) => idx !== index);
  persistTrip();
  renderTrip();
  if (!currentCoords() && !el.destinationInput.value.trim()) setMessage(idleComposerPrompt());
}

function idleComposerPrompt() {
  return tripStops.length > 0
    ? "Paste, locate, or tap a quick place to add another stop."
    : "Paste a map link or coordinates to begin.";
}

function renderTrip() {
  updateAddToTripButton();
  if (!tripStops.length) {
    el.tripCard.hidden = true;
    updateSendDock();
    renderQuickPlaces();
    return;
  }
  el.tripCard.hidden = false;
  el.tripCountPill.textContent = `${tripStops.length} / ${TRIP_MAX}`;
  el.clearTripButton.disabled = sending;

  const isTripSending = sending && sendingMode === "trip";
  const activeStopIndex = isTripSending && activeTripStep >= 0 && activeTripSchedule[activeTripStep]
    ? activeTripSchedule[activeTripStep].stopIndex
    : -1;

  el.tripList.replaceChildren();
  for (let i = 0; i < tripStops.length; i++) {
    const stop = tripStops[i];
    const isFinal = i === tripStops.length - 1;
    const li = document.createElement("li");
    li.className = "trip-row";
    li.dataset.tripIndex = String(i);
    li.tabIndex = 0;
    if (completedTripIndices.has(i)) li.classList.add("tx-done");
    else if (i === activeStopIndex) li.classList.add("tx-active");
    else if (i === lastMovedTripIndex) li.classList.add("just-moved");

    const marker = document.createElement("span");
    marker.className = `trip-marker${isFinal ? " final" : ""}`;
    marker.textContent = completedTripIndices.has(i) ? "✓" : (isFinal ? "END" : String(i + 1));

    const copy = document.createElement("div");
    copy.className = "trip-stop-copy";
    const strong = document.createElement("strong");
    strong.textContent = stop.name;
    const small = document.createElement("small");
    small.textContent = `${isFinal ? "Destination" : `Stop ${i + 1}`} · ${stop.lat.toFixed(5)}, ${stop.lon.toFixed(5)}`;
    copy.append(strong, small);

    const ctrls = document.createElement("div");
    ctrls.className = "trip-row-controls";

    const upBtn = document.createElement("button");
    upBtn.type = "button";
    upBtn.className = "trip-ctrl-btn";
    upBtn.dataset.tripAction = "up";
    upBtn.dataset.tripIndex = String(i);
    upBtn.innerHTML = ICONS.up;
    upBtn.disabled = sending || i === 0;
    upBtn.setAttribute("aria-label", `Move ${stop.name} up`);

    const downBtn = document.createElement("button");
    downBtn.type = "button";
    downBtn.className = "trip-ctrl-btn";
    downBtn.dataset.tripAction = "down";
    downBtn.dataset.tripIndex = String(i);
    downBtn.innerHTML = ICONS.down;
    downBtn.disabled = sending || isFinal;
    downBtn.setAttribute("aria-label", `Move ${stop.name} down`);

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "trip-ctrl-btn danger";
    delBtn.dataset.tripAction = "remove";
    delBtn.dataset.tripIndex = String(i);
    delBtn.innerHTML = ICONS.close;
    delBtn.disabled = sending;
    delBtn.setAttribute("aria-label", `Remove ${stop.name} from trip`);

    ctrls.append(upBtn, downBtn, delBtn);
    li.append(marker, copy, ctrls);
    el.tripList.appendChild(li);
  }

  updateSendDock();
  renderQuickPlaces();
}

function moveInMemory(list, index, delta) {
  const target = index + delta;
  if (target < 0 || target >= list.length) return list;
  const copy = list.slice();
  [copy[index], copy[target]] = [copy[target], copy[index]];
  return copy;
}

function loadQuickPlace(entry, sourceLabel) {
  clearTimeout(parseTimer);
  resetShortLink();
  el.destinationInput.value = "";
  autoResizeInput();
  el.latInput.value = entry.lat.toFixed(6);
  el.lonInput.value = entry.lon.toFixed(6);
  el.nameInput.value = entry.name || "Phone destination";
  if (entry.action === "S" || entry.action === "N") setSendAction(entry.action);
  updateConfidenceBadge("exact");
  setMessage(`${sourceLabel} ready to send.`, "success");
  updateDestination(sourceLabel);
  if (activeMainTab !== "send") switchTab("send");
  showToast(`Loaded ${entry.name || "destination"}`);
}

function renderPlaces() {
  renderParked();
  const totalBadge = (canStorePlaces ? (savedPlaces.length || recentPlaces.length) : 0) + (parkedSpot ? 1 : 0);
  el.placesBadge.hidden = totalBadge === 0;
  if (totalBadge > 0) el.placesBadge.textContent = String(totalBadge);

  if (!canStorePlaces) {
    el.savedTabButton.textContent = "Saved";
    el.recentTabButton.textContent = "Recent";
    el.clearRecentsButton.hidden = true;
    el.placesList.replaceChildren();
    el.placesEmpty.hidden = false;
    el.placesEmptyTitle.textContent = "Browser storage unavailable";
    el.placesEmptyText.textContent = "Saved and recent places stay on your device when browser storage is enabled.";
    renderQuickPlaces();
    return;
  }

  const isSavedTab = activePlacesTab === "saved";
  el.savedTabButton.classList.toggle("selected", isSavedTab);
  el.recentTabButton.classList.toggle("selected", !isSavedTab);
  el.savedTabButton.setAttribute("aria-selected", String(isSavedTab));
  el.recentTabButton.setAttribute("aria-selected", String(!isSavedTab));
  el.savedTabButton.textContent = savedPlaces.length ? `Saved (${savedPlaces.length})` : "Saved";
  el.recentTabButton.textContent = recentPlaces.length ? `Recent (${recentPlaces.length})` : "Recent";
  el.clearRecentsButton.hidden = isSavedTab || !recentPlaces.length;

  const list = isSavedTab ? savedPlaces : recentPlaces;
  el.placesList.replaceChildren();
  if (!list.length) {
    el.placesEmpty.hidden = false;
    el.placesEmptyTitle.textContent = isSavedTab ? "No saved places yet" : "No recent sends yet";
    el.placesEmptyText.textContent = isSavedTab
      ? "Tap Save on any destination to keep it on your phone for one-tap sending."
      : "Destinations you send to ClioPlay appear here automatically.";
    renderQuickPlaces();
    return;
  }

  el.placesEmpty.hidden = true;
  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    const li = document.createElement("li");
    li.className = "place-row";

    const loadBtn = document.createElement("button");
    loadBtn.type = "button";
    loadBtn.className = "place-load";

    const avatar = document.createElement("span");
    avatar.className = `place-avatar${isSavedTab ? "" : " recent"}`;
    avatar.setAttribute("aria-hidden", "true");
    avatar.innerHTML = isSavedTab ? ICONS.bookmark : ICONS.clock;

    const textWrap = document.createElement("span");
    textWrap.className = "place-text";

    const title = document.createElement("strong");
    title.textContent = item.name;
    if (!isSavedTab && item.action === "S") {
      const badge = document.createElement("span");
      badge.className = "place-badge";
      badge.textContent = "Stop";
      title.appendChild(badge);
    }
    const coords = document.createElement("small");
    coords.textContent = `${item.lat.toFixed(5)}, ${item.lon.toFixed(5)}`;
    textWrap.append(title, coords);
    loadBtn.append(avatar, textWrap);
    loadBtn.addEventListener("click", () => loadQuickPlace(item, isSavedTab ? "Saved place" : "Recent"));
    li.appendChild(loadBtn);

    const actions = document.createElement("div");
    actions.className = "place-actions";

    const tripAddBtn = document.createElement("button");
    tripAddBtn.type = "button";
    tripAddBtn.className = "place-icon-btn";
    tripAddBtn.innerHTML = ICONS.plus;
    tripAddBtn.title = "Add to trip";
    tripAddBtn.setAttribute("aria-label", `Add ${item.name} to trip`);
    tripAddBtn.addEventListener("click", () => {
      enqueueTripStop({ name: item.name, lat: item.lat, lon: item.lon });
    });
    actions.appendChild(tripAddBtn);

    if (isSavedTab) {
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "place-icon-btn danger";
      removeBtn.innerHTML = ICONS.trash;
      removeBtn.setAttribute("aria-label", `Remove ${item.name}`);
      removeBtn.addEventListener("click", () => {
        savedPlaces = removeSavedPlace(localStorage, i);
        updateSaveButton(currentCoords());
        renderPlaces();
        showToast("Removed from Saved");
      });
      actions.appendChild(removeBtn);
    } else {
      const savedIdx = findSavedIndex(savedPlaces, item.lat, item.lon);
      const saveBtn = document.createElement("button");
      saveBtn.type = "button";
      saveBtn.className = `place-icon-btn${savedIdx >= 0 ? " saved" : ""}`;
      saveBtn.innerHTML = ICONS.bookmark;
      saveBtn.setAttribute("aria-label", savedIdx >= 0 ? `Remove ${item.name} from Saved` : `Save ${item.name}`);
      saveBtn.addEventListener("click", () => {
        const idx = findSavedIndex(savedPlaces, item.lat, item.lon);
        if (idx >= 0) {
          savedPlaces = removeSavedPlace(localStorage, idx);
          showToast("Removed from Saved");
        } else {
          savedPlaces = savePlace(localStorage, { name: item.name, lat: item.lat, lon: item.lon });
          showToast("Saved to Places");
        }
        updateSaveButton(currentCoords());
        renderPlaces();
      });
      actions.appendChild(saveBtn);
    }

    li.appendChild(actions);
    el.placesList.appendChild(li);
  }
  renderQuickPlaces();
}

function updateDestination(provider = currentProvider || "Destination") {
  currentProvider = provider;
  updateClearButton();
  const coords = currentCoords();
  if (!coords) {
    el.destinationCard.hidden = true;
    el.savePlaceButton.hidden = true;
    updateSendDock();
    renderQuickPlaces();
    return;
  }

  const name = el.nameInput.value.trim() || "Phone destination";
  el.sourceReadout.textContent = provider;
  el.previewName.textContent = name;
  el.previewCoords.textContent = `${coords.lat.toFixed(6)}, ${coords.lon.toFixed(6)}`;
  el.destinationCard.hidden = false;
  updateNameCounter();
  updateSaveButton(coords);
  updateAddToTripButton();
  updateSendDock();
  renderQuickPlaces();
}

function applyParsed(result) {
  el.latInput.value = result.lat.toFixed(6);
  el.lonInput.value = result.lon.toFixed(6);
  el.nameInput.value = result.name || "Phone destination";
  updateConfidenceBadge(result.confidence);

  let note = `${result.provider} destination ready.`;
  let tone = "success";
  if (result.confidence === "map-center") {
    note = "Points to the map centre — verify coordinates before sending.";
    tone = "warning";
  } else if (result.confidence === "heuristic") {
    note = "Coordinates estimated from link — check before sending.";
    tone = "warning";
  }

  const simplified = sanitiseAvrcpName(el.nameInput.value);
  if (simplified !== el.nameInput.value.trim().normalize("NFC")) {
    note += " Name will trim to 40 chars on ClioPlay.";
  }
  setMessage(note, tone);
  updateDestination(result.provider);

  if (pendingAddToTripAfterExpand) {
    pendingAddToTripAfterExpand = false;
    enqueueTripStop({ name: el.nameInput.value.trim(), lat: result.lat, lon: result.lon }, { clearComposer: true });
  }
}

function clearDestination() {
  el.latInput.value = "";
  el.lonInput.value = "";
  el.nameInput.value = "";
  el.destinationCard.hidden = true;
  el.savePlaceButton.hidden = true;
  updateClearButton();
  updateSendDock();
  renderQuickPlaces();
}

function resetShortLink() {
  activeLookup?.abort();
  activeLookup = null;
  shortDestination = null;
  el.expandSpinner.hidden = true;
  el.shortLinkActions.hidden = true;
  el.openShortLink.removeAttribute("href");
  el.expandLink.disabled = false;
  el.expandLink.textContent = "Expand short link";
}

function clearAllInputs() {
  clearTimeout(parseTimer);
  pendingAddToTripAfterExpand = false;
  resetShortLink();
  el.destinationInput.value = "";
  autoResizeInput();
  clearDestination();
  setMessage(idleComposerPrompt());
}

function parseInput() {
  clearTimeout(parseTimer);
  resetShortLink();
  updateClearButton();
  const result = parseDestination(el.destinationInput.value);
  if (result.ok) {
    applyParsed(result);
    return;
  }

  clearDestination();
  if (result.shortLink) {
    shortDestination = result;
    el.openShortLink.href = result.shortLink;
    el.expandLink.hidden = !resolverEndpoint;
    if (resolverEndpoint && autoExpandEnabled) {
      resolveShortDestination();
    } else {
      pendingAddToTripAfterExpand = false;
      el.shortLinkActions.hidden = false;
      setMessage(resolverEndpoint
        ? `Tap Expand to resolve this ${result.provider} short link.`
        : result.error);
    }
  } else if (el.destinationInput.value.trim()) {
    pendingAddToTripAfterExpand = false;
    setMessage(result.error, "error");
  } else {
    pendingAddToTripAfterExpand = false;
    setMessage(idleComposerPrompt());
  }
}

function scheduleParse() {
  pendingAddToTripAfterExpand = false;
  autoResizeInput();
  updateClearButton();
  resetShortLink();
  clearDestination();
  clearTimeout(parseTimer);
  parseTimer = setTimeout(parseInput, 220);
}

async function resolveShortDestination() {
  if (!shortDestination || !resolverEndpoint || activeLookup) return;
  const source = shortDestination;
  const lookup = new AbortController();
  activeLookup = lookup;
  const timeout = setTimeout(() => lookup.abort(), 9500);
  el.expandLink.disabled = true;
  el.expandSpinner.hidden = false;
  el.shortLinkActions.hidden = true;
  setMessage(`Expanding ${source.provider} link…`);

  try {
    const expanded = await expandMapLink(source.shortLink, resolverEndpoint, lookup.signal);
    if (activeLookup !== lookup) return;
    const result = parseDestination(expanded);
    if (result.ok) {
      resetShortLink();
      applyParsed({ ...result, name: result.name || source.sharedName });
    } else {
      pendingAddToTripAfterExpand = false;
      el.openShortLink.href = expanded;
      el.expandLink.textContent = "Retry expand";
      el.shortLinkActions.hidden = false;
      setMessage(result.error, "error");
    }
  } catch (error) {
    if (activeLookup === lookup) {
      pendingAddToTripAfterExpand = false;
      el.expandLink.textContent = "Retry expand";
      el.shortLinkActions.hidden = false;
      const reason = error?.name === "AbortError"
        ? "Expansion timed out. Retry or open the link in your browser and copy the full URL."
        : "Could not expand this short link. Retry or open it in a browser and paste the full URL.";
      setMessage(reason, "error");
    }
  } finally {
    clearTimeout(timeout);
    if (activeLookup === lookup) {
      activeLookup = null;
      el.expandSpinner.hidden = true;
      el.expandLink.disabled = false;
    }
  }
}

function requestGpsFix() {
  return new Promise((resolve, reject) => {
    if (!geoSupported()) {
      reject(new Error("Location is not available in this browser."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      pos => resolve({
        lat: pos.coords.latitude,
        lon: pos.coords.longitude,
        accuracy: Number.isFinite(pos.coords.accuracy) ? Math.round(pos.coords.accuracy) : null
      }),
      err => {
        if (err?.code === 1) reject(new Error("Location permission was denied."));
        else if (err?.code === 3) reject(new Error("Location timed out — try again outside or near a window."));
        else reject(new Error("Could not determine your current GPS location."));
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 10000 }
    );
  });
}

async function locateIntoComposer() {
  if (!geoSupported()) return;
  clearTimeout(parseTimer);
  resetShortLink();
  el.locateButton.disabled = true;
  el.expandSpinner.hidden = false;
  setMessage("Finding your GPS location…");
  try {
    const fix = await requestGpsFix();
    el.destinationInput.value = "";
    autoResizeInput();
    el.latInput.value = fix.lat.toFixed(6);
    el.lonInput.value = fix.lon.toFixed(6);
    el.nameInput.value = "My location";
    updateConfidenceBadge("exact");
    const acc = fix.accuracy !== null ? ` (±${fix.accuracy} m)` : "";
    setMessage(`Current location ready${acc}.`, "success");
    updateDestination("My Location");
    vibrate(10);
  } catch (error) {
    setMessage(error?.message || "Could not get GPS location.", "error");
  } finally {
    el.locateButton.disabled = false;
    el.expandSpinner.hidden = true;
  }
}

async function saveParkedHere() {
  if (!geoSupported()) return;
  el.parkHereButton.disabled = true;
  el.parkHereButton.textContent = "Locating…";
  try {
    const fix = await requestGpsFix();
    const spot = { name: "Parked car", lat: fix.lat, lon: fix.lon, accuracy: fix.accuracy };
    parkedSpot = canStorePlaces ? saveParkedSpot(localStorage, spot) : { ...spot, at: Date.now() };
    renderPlaces();
    vibrate([10, 30, 10]);
    const acc = fix.accuracy !== null ? ` (±${fix.accuracy} m)` : "";
    showToast(`Parking spot saved${acc}`);
  } catch (error) {
    showToast(error?.message || "Could not get GPS fix");
  } finally {
    el.parkHereButton.disabled = false;
    renderParked();
  }
}

function makeSilentWav(seconds) {
  const sampleRate = 8000, samples = sampleRate * seconds, dataBytes = samples * 2;
  const buffer = new ArrayBuffer(44 + dataBytes), view = new DataView(buffer);
  const write = (offset, text) => { for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i)); };
  write(0, "RIFF"); view.setUint32(4, 36 + dataBytes, true); write(8, "WAVE"); write(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  write(36, "data"); view.setUint32(40, dataBytes, true);
  return new Blob([buffer], { type: "audio/wav" });
}

function setSendAction(action) {
  sendAction = action === "S" ? "S" : "N";
  const isNew = sendAction === "N";
  el.routeNewButton.classList.toggle("selected", isNew);
  el.addStopButton.classList.toggle("selected", !isNew);
  el.routeNewButton.setAttribute("aria-pressed", String(isNew));
  el.addStopButton.setAttribute("aria-pressed", String(!isNew));
}

function publishMetadata(packet, slotDuration = sendSeconds) {
  navigator.mediaSession.metadata = new MediaMetadata({ title: packet.title, artist: packet.artist, album: packet.album });
  try { navigator.mediaSession.playbackState = "playing"; } catch { }
  try {
    navigator.mediaSession.setPositionState?.({ duration: slotDuration, playbackRate: 1, position: 0 });
  } catch { }
}

function clearMediaSession() {
  try {
    navigator.mediaSession.metadata = null;
    navigator.mediaSession.playbackState = "none";
  } catch { }
}

function stopSendLoops() {
  if (sendRafId) cancelAnimationFrame(sendRafId);
  sendRafId = 0;
  clearInterval(tripStepTimer);
  tripStepTimer = null;
}

function tickSendProgress() {
  if (!sending || sendingMode !== "single") return;
  const totalMs = sendSeconds * 1000;
  const elapsed = Math.max(0, performance.now() - sendStartMs);
  const pct = Math.min(100, (elapsed / totalMs) * 100);
  const remaining = Math.max(1, Math.ceil((totalMs - elapsed) / 1000));
  el.sendProgressFill.style.width = `${pct.toFixed(1)}%`;
  el.sendSubtext.textContent = `Keep phone connected · ${remaining}s`;
  if (pct < 100) sendRafId = requestAnimationFrame(tickSendProgress);
}

function advanceTripStep() {
  if (!sending || sendingMode !== "trip" || !activeTripSchedule.length) return;
  const slotMs = sendSeconds * 1000;
  const totalMs = activeTripSchedule.length * slotMs;
  const elapsed = Math.max(performance.now() - sendStartMs, (el.txAudio.currentTime || 0) * 1000);
  const step = Math.min(activeTripSchedule.length - 1, Math.floor(elapsed / slotMs));
  const pct = Math.min(100, (elapsed / totalMs) * 100);
  const remaining = Math.max(1, Math.ceil((totalMs - elapsed) / 1000));

  if (step > activeTripStep) {
    for (let s = Math.max(0, activeTripStep); s < step; s++) {
      completedTripIndices.add(activeTripSchedule[s].stopIndex);
    }
    activeTripStep = step;
    const entry = activeTripSchedule[step];
    publishMetadata(entry.packet, sendSeconds);
    renderTrip();
  }

  const cur = activeTripSchedule[activeTripStep];
  el.sendProgressFill.style.width = `${pct.toFixed(1)}%`;
  el.sendLabel.textContent = `Sending ${activeTripStep + 1} of ${activeTripSchedule.length}…`;
  const kindLabel = cur.action === "N" ? "Destination" : `Stop ${cur.stopIndex + 1}`;
  el.sendSubtext.textContent = `${kindLabel}: ${cur.stop.name} · ${remaining}s`;
  setBtStatus("sending", `${activeTripStep + 1}/${activeTripSchedule.length}`);
}

function tickTripProgress() {
  if (!sending || sendingMode !== "trip") return;
  advanceTripStep();
  sendRafId = requestAnimationFrame(tickTripProgress);
}

function showSentSingle() {
  stopSendLoops();
  el.sendButton.classList.remove("sending");
  el.sendButton.classList.add("sent");
  el.sendProgressFill.style.width = "100%";
  el.sendIcon.innerHTML = ICONS.check;
  el.sendButton.disabled = !currentCoords() || !mediaSupported();
  el.sendLabel.textContent = "Sent to ClioPlay";
  el.sendSubtext.textContent = "Check the destination on your screen";
  setBtStatus("sent", "Sent");
  vibrate([14, 40, 14]);
  renderTrip();
  clearTimeout(sentTimer);
  sentTimer = setTimeout(() => {
    el.sendButton.classList.remove("sent");
    el.sendProgressFill.style.width = "0%";
    el.sendIcon.innerHTML = ICONS.send;
    setBtStatus(mediaSupported() ? "ready" : "error", mediaSupported() ? "Ready" : "Unsupported");
    updateSendDock();
  }, 2400);
}

function showSentTrip(count) {
  stopSendLoops();
  for (const entry of activeTripSchedule) completedTripIndices.add(entry.stopIndex);
  activeTripSchedule = [];
  activeTripStep = -1;
  el.cancelTripButton.hidden = true;
  el.sendButton.classList.remove("sending");
  el.sendButton.classList.add("sent");
  el.sendProgressFill.style.width = "100%";
  el.sendIcon.innerHTML = ICONS.check;
  el.sendButton.disabled = !mediaSupported();
  el.sendLabel.textContent = count === 1 ? "Destination sent" : `Trip sent (${count} stops)`;
  el.sendSubtext.textContent = "Check your itinerary on ClioPlay";
  setBtStatus("sent", "Sent");
  vibrate([14, 40, 14]);
  renderTrip();
  clearTimeout(sentTimer);
  sentTimer = setTimeout(() => {
    completedTripIndices.clear();
    el.sendButton.classList.remove("sent");
    el.sendProgressFill.style.width = "0%";
    el.sendIcon.innerHTML = ICONS.send;
    setBtStatus(mediaSupported() ? "ready" : "error", mediaSupported() ? "Ready" : "Unsupported");
    renderTrip();
  }, 2800);
}

function cancelTripTransfer() {
  if (!sending || sendingMode !== "trip") return;
  sending = false;
  sendingMode = "";
  stopSendLoops();
  try { el.txAudio.pause(); el.txAudio.currentTime = 0; } catch { }
  clearMediaSession();
  activeTripSchedule = [];
  activeTripStep = -1;
  completedTripIndices.clear();
  el.cancelTripButton.hidden = true;
  el.sendButton.classList.remove("sending", "sent");
  el.sendProgressFill.style.width = "0%";
  el.sendIcon.innerHTML = ICONS.send;
  setBtStatus(mediaSupported() ? "ready" : "error", mediaSupported() ? "Ready" : "Unsupported");
  renderTrip();
  updateSendDock();
  showToast("Trip transfer cancelled");
}

async function transmit() {
  const coords = currentCoords();
  if (sending || !coords || !mediaSupported()) return;
  sending = true;
  sendingMode = "single";
  clearTimeout(sentTimer);
  stopSendLoops();
  el.sendButton.classList.remove("sent");
  el.sendButton.classList.add("sending");
  el.sendProgressFill.style.width = "0%";
  vibrate(12);

  const packet = buildPacket(coords.lat, coords.lon, el.nameInput.value.trim(), nextSequence(), sendAction);
  pendingSentPlace = { name: el.nameInput.value.trim() || "Phone destination", lat: coords.lat, lon: coords.lon, action: sendAction };
  if (audioObjectUrl) URL.revokeObjectURL(audioObjectUrl);
  audioObjectUrl = URL.createObjectURL(makeSilentWav(sendSeconds));
  el.txAudio.src = audioObjectUrl;
  el.txAudio.volume = 1;

  el.sendButton.disabled = true;
  el.sendIcon.innerHTML = ICONS.wave;
  el.sendLabel.textContent = sendAction === "S" ? "Sending stop…" : "Sending destination…";
  el.sendSubtext.textContent = `Keep phone connected · ${sendSeconds}s`;
  setBtStatus("sending", "Sending");
  renderTrip();

  try {
    publishMetadata(packet, sendSeconds);
    await el.txAudio.play();
    publishMetadata(packet, sendSeconds);
    sendStartMs = performance.now();
    sendRafId = requestAnimationFrame(tickSendProgress);
  } catch (error) {
    sending = false;
    sendingMode = "";
    stopSendLoops();
    clearMediaSession();
    el.sendButton.classList.remove("sending");
    el.sendProgressFill.style.width = "0%";
    el.sendIcon.innerHTML = ICONS.send;
    setBtStatus("ready", "Ready");
    renderTrip();
    updateSendDock();
    setMessage(`Could not start Bluetooth media transfer: ${error?.message || error}`, "error");
  }
}

async function transmitTrip() {
  if (sending || !tripStops.length || !mediaSupported()) return;
  const schedule = buildTripPackets(tripStops, nextSequence);
  if (!schedule.length) return;

  sending = true;
  sendingMode = "trip";
  activeTripSchedule = schedule;
  activeTripStep = 0;
  completedTripIndices.clear();
  clearTimeout(sentTimer);
  stopSendLoops();
  el.sendButton.classList.remove("sent");
  el.sendButton.classList.add("sending");
  el.sendProgressFill.style.width = "0%";
  el.cancelTripButton.hidden = false;
  vibrate(12);

  const totalSeconds = schedule.length * sendSeconds;
  if (audioObjectUrl) URL.revokeObjectURL(audioObjectUrl);
  audioObjectUrl = URL.createObjectURL(makeSilentWav(totalSeconds));
  el.txAudio.src = audioObjectUrl;
  el.txAudio.volume = 1;

  el.sendButton.disabled = true;
  el.sendIcon.innerHTML = ICONS.wave;
  el.sendLabel.textContent = `Sending 1 of ${schedule.length}…`;
  el.sendSubtext.textContent = `Destination: ${schedule[0].stop.name} · ${totalSeconds}s`;
  setBtStatus("sending", `1/${schedule.length}`);
  renderTrip();

  try {
    publishMetadata(schedule[0].packet, sendSeconds);
    await el.txAudio.play();
    publishMetadata(schedule[0].packet, sendSeconds);
    sendStartMs = performance.now();
    tripStepTimer = setInterval(advanceTripStep, 250);
    sendRafId = requestAnimationFrame(tickTripProgress);
  } catch (error) {
    sending = false;
    sendingMode = "";
    activeTripSchedule = [];
    activeTripStep = -1;
    stopSendLoops();
    clearMediaSession();
    el.cancelTripButton.hidden = true;
    el.sendButton.classList.remove("sending");
    el.sendProgressFill.style.width = "0%";
    el.sendIcon.innerHTML = ICONS.send;
    setBtStatus("ready", "Ready");
    renderTrip();
    updateSendDock();
    setMessage(`Could not start Bluetooth trip transfer: ${error?.message || error}`, "error");
  }
}

function shortcutBaseUrl() {
  if (location.protocol === "https:" && !/^(?:localhost|127\.0\.0\.1)$/i.test(location.hostname)) {
    return `${location.origin}${location.pathname}?text=`;
  }
  return "https://pxwel-dev.github.io/ClioPlay-Send/?text=";
}

function updateInstallUi() {
  const standalone = window.matchMedia?.("(display-mode: standalone)")?.matches || navigator.standalone === true;
  const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  if (standalone) {
    el.installButton.hidden = true;
    el.settingsInstallButton.hidden = true;
    el.installedBadge.hidden = false;
    el.installStatusTitle.textContent = "Installed as app";
    el.installStatusText.textContent = "Running in standalone app mode with offline support.";
    return;
  }
  el.installedBadge.hidden = true;
  if (deferredInstall) {
    el.installButton.hidden = false;
    el.settingsInstallButton.hidden = false;
    el.installStatusTitle.textContent = "Install on phone";
    el.installStatusText.textContent = "Install ClioPlay Send for full-screen app mode and Share Sheet support.";
  } else if (isIos) {
    el.installButton.hidden = true;
    el.settingsInstallButton.hidden = true;
    el.installStatusTitle.textContent = "Add to iPhone Home Screen";
    el.installStatusText.textContent = "In Safari, tap Share then Add to Home Screen for app mode.";
  }
}

async function promptInstall() {
  if (!deferredInstall) return;
  deferredInstall.prompt();
  await deferredInstall.userChoice;
  deferredInstall = null;
  updateInstallUi();
}

// Event Listeners
el.txAudio.addEventListener("timeupdate", advanceTripStep);
el.txAudio.addEventListener("ended", () => {
  if (!sending) return;
  const mode = sendingMode;
  sending = false;
  sendingMode = "";
  clearMediaSession();

  if (mode === "trip") {
    const count = activeTripSchedule.length;
    if (canStorePlaces && count > 0) {
      for (const entry of activeTripSchedule) {
        recentPlaces = recordRecent(localStorage, { ...entry.stop, action: entry.action });
      }
      renderPlaces();
    }
    showSentTrip(count);
    return;
  }

  if (canStorePlaces && pendingSentPlace) {
    recentPlaces = recordRecent(localStorage, pendingSentPlace);
    renderPlaces();
  }
  pendingSentPlace = null;
  showSentSingle();
});

for (const navBtn of [el.navSend, el.navPlaces, el.navSettings]) {
  navBtn.addEventListener("click", () => switchTab(navBtn.dataset.tab));
}
el.quickPlacesAll.addEventListener("click", () => switchTab("places"));

if (!geoSupported()) {
  el.locateButton.hidden = true;
} else {
  el.locateButton.addEventListener("click", locateIntoComposer);
}
el.parkHereButton.addEventListener("click", saveParkedHere);
el.loadParkedButton.addEventListener("click", () => {
  if (!parkedSpot) return;
  loadQuickPlace({ ...parkedSpot, action: "N" }, "Parked car");
});
el.addParkedToTripButton.addEventListener("click", () => {
  if (!parkedSpot) return;
  enqueueTripStop({ name: parkedSpot.name || "Parked car", lat: parkedSpot.lat, lon: parkedSpot.lon });
});
el.clearParkedButton.addEventListener("click", () => {
  parkedSpot = canStorePlaces ? clearParkedSpot(localStorage) : null;
  renderPlaces();
  showToast("Parking spot cleared");
});

el.manualCoordsToggle.addEventListener("click", () => {
  const opening = el.manualCoordsPanel.hidden;
  el.manualCoordsPanel.hidden = !opening;
  el.manualCoordsToggle.setAttribute("aria-expanded", String(opening));
  if (opening) el.latInput.focus();
});

el.clearInputButton.addEventListener("click", clearAllInputs);

el.addToTripButton.addEventListener("click", () => {
  const coords = currentCoords();
  if (!coords || sending) return;
  enqueueTripStop({ name: el.nameInput.value.trim() || "Phone destination", lat: coords.lat, lon: coords.lon }, { clearComposer: true });
});

el.tripList.addEventListener("click", event => {
  const btn = event.target.closest("button[data-trip-action]");
  if (!btn || btn.disabled) return;
  const idx = Number(btn.dataset.tripIndex);
  const action = btn.dataset.tripAction;
  if (action === "up") moveStopBy(idx, -1, "up");
  else if (action === "down") moveStopBy(idx, 1, "down");
  else if (action === "remove") removeStopAt(idx);
});

el.tripList.addEventListener("keydown", event => {
  if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
  const row = event.target.closest("li[data-trip-index]");
  if (!row) return;
  event.preventDefault();
  const idx = Number(row.dataset.tripIndex);
  const delta = event.key === "ArrowUp" ? -1 : 1;
  moveStopBy(idx, delta, event.key === "ArrowUp" ? "up" : "down");
});

el.clearTripButton.addEventListener("click", () => {
  if (sending) return;
  tripStops = canStorePlaces ? clearTrip(localStorage) : [];
  completedTripIndices.clear();
  renderTrip();
  if (!currentCoords() && !el.destinationInput.value.trim()) setMessage(idleComposerPrompt());
  showToast("Trip cleared");
});

el.cancelTripButton.addEventListener("click", cancelTripTransfer);

el.savePlaceButton.addEventListener("click", () => {
  const coords = currentCoords();
  if (!canStorePlaces || !coords) return;
  const idx = findSavedIndex(savedPlaces, coords.lat, coords.lon);
  if (idx >= 0) {
    savedPlaces = removeSavedPlace(localStorage, idx);
    showToast("Removed from Saved");
  } else {
    savedPlaces = savePlace(localStorage, { name: el.nameInput.value.trim() || "Phone destination", lat: coords.lat, lon: coords.lon });
    activePlacesTab = "saved";
    showToast("Saved to Places");
  }
  updateSaveButton(coords);
  renderPlaces();
});

el.savedTabButton.addEventListener("click", () => { activePlacesTab = "saved"; renderPlaces(); });
el.recentTabButton.addEventListener("click", () => { activePlacesTab = "recent"; renderPlaces(); });
el.clearRecentsButton.addEventListener("click", () => {
  if (!canStorePlaces) return;
  recentPlaces = clearRecents(localStorage);
  renderPlaces();
  showToast("Recent sends cleared");
});

el.sendButton.addEventListener("click", () => {
  if (tripStops.length > 0) transmitTrip();
  else transmit();
});
el.routeNewButton.addEventListener("click", () => setSendAction("N"));
el.addStopButton.addEventListener("click", () => setSendAction("S"));

el.durationPills.addEventListener("click", event => {
  const btn = event.target.closest("[data-duration]");
  if (!btn) return;
  setTransferDuration(Number(btn.dataset.duration), true);
  showToast(`Transfer window: ${sendSeconds}s`);
});

el.autoExpandToggle.addEventListener("click", () => {
  if (!resolverEndpoint) return;
  autoExpandEnabled = !autoExpandEnabled;
  el.autoExpandToggle.setAttribute("aria-checked", String(autoExpandEnabled));
  remember("clp-auto-expand", autoExpandEnabled ? "1" : "0");
});

el.copyShortcutUrlButton.addEventListener("click", async () => {
  const url = shortcutBaseUrl();
  try {
    await navigator.clipboard.writeText(url);
    showToast("Copied Shortcut URL");
  } catch {
    showToast("Select and copy the URL shown");
  }
});

el.releaseReopen.addEventListener("click", () => {
  window.scrollTo({ top: 0, behavior: "smooth" });
});

el.destinationInput.addEventListener("input", scheduleParse);
el.expandLink.addEventListener("click", resolveShortDestination);
el.nameInput.addEventListener("input", () => updateDestination(currentProvider));

function onManualCoordInput() {
  clearTimeout(parseTimer);
  resetShortLink();
  updateConfidenceBadge("exact");
  updateDestination("Coordinates");
  if (currentCoords()) setMessage("Coordinates ready.", "success");
}
el.latInput.addEventListener("input", onManualCoordInput);
el.lonInput.addEventListener("input", onManualCoordInput);

el.pasteButton.addEventListener("click", async () => {
  try {
    const clip = await navigator.clipboard.readText();
    if (!clip.trim()) {
      setMessage("Clipboard is empty.", "error");
      return;
    }
    el.destinationInput.value = clip;
    autoResizeInput();
    parseInput();
  } catch {
    setMessage("Clipboard access unavailable — long-press the field and paste.", "error");
    el.destinationInput.focus();
  }
});

window.addEventListener("beforeinstallprompt", event => {
  event.preventDefault();
  deferredInstall = event;
  updateInstallUi();
});
window.addEventListener("appinstalled", () => {
  deferredInstall = null;
  updateInstallUi();
  showToast("ClioPlay Send installed");
});
el.installButton.addEventListener("click", promptInstall);
el.settingsInstallButton.addEventListener("click", promptInstall);

function consumeShareTarget() {
  const shared = parseShareParams(location.search);
  if (!shared) return;
  history.replaceState({}, "", location.pathname);
  if (shared.action) setSendAction(shared.action);
  if (shared.kind === "coords") {
    if (shared.addToTrip) {
      enqueueTripStop({ name: shared.name || "Shared destination", lat: shared.lat, lon: shared.lon });
    } else {
      applyParsed({
        lat: shared.lat,
        lon: shared.lon,
        name: shared.name,
        provider: "Shared link",
        confidence: "exact"
      });
    }
    return;
  }
  pendingAddToTripAfterExpand = Boolean(shared.addToTrip);
  el.destinationInput.value = shared.text;
  autoResizeInput();
  parseInput();
}

if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => {});
if (!mediaSupported()) {
  setBtStatus("error", "Unsupported");
  setMessage("This browser does not support Bluetooth media metadata transfers.", "error");
} else {
  setBtStatus("ready", "Ready");
}
el.shortcutUrlPreview.textContent = shortcutBaseUrl();
loadPreferences();
setSendAction("N");
renderPlaces();
renderTrip();
if (!currentCoords() && !el.destinationInput.value.trim()) setMessage(idleComposerPrompt());
updateInstallUi();
consumeShareTarget();
