import { parseDestination, buildPacket, sanitiseAvrcpName, validCoords } from "./parser.js?v=20261126";
import { expandMapLink } from "./short-links.js?v=20261126";
import {
  RECENT_KEY, SAVED_KEY, RECENT_MAX, SAVED_MAX,
  storageAvailable, loadPlaces, recordRecent, clearRecents,
  findSavedIndex, savePlace, removeSavedPlace
} from "./places-store.js?v=20261126";

const resolverEndpoint = document.querySelector('meta[name="map-link-resolver"]')?.content.trim();
const $ = id => document.getElementById(id);

const ICONS = {
  send: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7Z"/></svg>`,
  wave: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.55a11 11 0 0 1 14.08 0M8.53 16.11a6 6 0 0 1 6.95 0M12 20h.01"/></svg>`,
  check: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`,
  bookmark: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16Z"/></svg>`,
  clock: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>`,
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
  latInput: $("latInput"),
  lonInput: $("lonInput"),
  routeNewButton: $("routeNewButton"),
  addStopButton: $("addStopButton"),
  sendButton: $("sendButton"),
  sendIcon: $("sendIcon"),
  sendLabel: $("sendLabel"),
  sendSubtext: $("sendSubtext"),
  sendDurationBadge: $("sendDurationBadge"),
  sendProgressFill: $("sendProgressFill"),
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
  releaseReopen: $("releaseReopen"),
  appToast: $("appToast"),
  txAudio: $("txAudio")
};

let deferredInstall = null;
let audioObjectUrl = null;
let parseTimer = null;
let shortDestination = null;
let activeLookup = null;
let sendAction = "N";
let sendSeconds = 4;
let autoExpandEnabled = Boolean(resolverEndpoint);
let sending = false;
let sendStartMs = 0;
let sendRafId = 0;
let sentTimer = null;
let toastTimer = null;
let currentProvider = "Destination";
let currentConfidence = "exact";
const canStorePlaces = storageAvailable();
let savedPlaces = canStorePlaces ? loadPlaces(localStorage, SAVED_KEY, SAVED_MAX) : [];
let recentPlaces = canStorePlaces ? loadPlaces(localStorage, RECENT_KEY, RECENT_MAX) : [];
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

function showToast(text) {
  if (!el.appToast) return;
  clearTimeout(toastTimer);
  el.appToast.textContent = text;
  el.appToast.hidden = false;
  toastTimer = setTimeout(() => { el.appToast.hidden = true; }, 2000);
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
  el.sendDurationBadge.textContent = `${sendSeconds}s`;
  for (const btn of el.durationPills.querySelectorAll("[data-duration]")) {
    const selected = Number(btn.dataset.duration) === sendSeconds;
    btn.classList.toggle("selected", selected);
    btn.setAttribute("aria-checked", String(selected));
  }
  if (!sending && currentCoords() && mediaSupported()) {
    el.sendSubtext.textContent = `Ready · ${sendSeconds}s Bluetooth window`;
  }
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

function renderQuickPlaces() {
  const hasDest = Boolean(currentCoords());
  if (!canStorePlaces || hasDest || (!savedPlaces.length && !recentPlaces.length)) {
    el.quickPlacesStrip.hidden = true;
    return;
  }
  const combined = [];
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
  el.quickPlacesList.replaceChildren();
  for (const entry of combined) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `quick-chip${entry.kind === "recent" ? " recent" : ""}`;
    btn.innerHTML = entry.kind === "saved" ? ICONS.bookmark : ICONS.clock;
    const span = document.createElement("span");
    span.textContent = entry.item.name;
    btn.appendChild(span);
    btn.addEventListener("click", () => {
      loadQuickPlace(entry.item, entry.kind === "saved" ? "Saved place" : "Recent");
    });
    el.quickPlacesList.appendChild(btn);
  }
  el.quickPlacesStrip.hidden = combined.length === 0;
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
  const totalBadge = savedPlaces.length || recentPlaces.length;
  el.placesBadge.hidden = !canStorePlaces || totalBadge === 0;
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
      li.appendChild(removeBtn);
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
      li.appendChild(saveBtn);
    }

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
    el.sendButton.disabled = true;
    el.sendSubtext.textContent = "Choose a destination first";
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
  el.sendButton.disabled = sending || !mediaSupported();
  if (!sending) {
    el.sendSubtext.textContent = mediaSupported()
      ? `Ready · ${sendSeconds}s Bluetooth window`
      : "Browser not supported";
  }
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
}

function clearDestination() {
  el.latInput.value = "";
  el.lonInput.value = "";
  el.nameInput.value = "";
  el.destinationCard.hidden = true;
  el.savePlaceButton.hidden = true;
  el.sendButton.disabled = true;
  el.sendSubtext.textContent = "Choose a destination first";
  updateClearButton();
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
  resetShortLink();
  el.destinationInput.value = "";
  autoResizeInput();
  clearDestination();
  setMessage("Paste a map link or coordinates to begin.");
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
      el.shortLinkActions.hidden = false;
      setMessage(resolverEndpoint
        ? `Tap Expand to resolve this ${result.provider} short link.`
        : result.error);
    }
  } else if (el.destinationInput.value.trim()) {
    setMessage(result.error, "error");
  } else {
    setMessage("Paste a map link or coordinates to begin.");
  }
}

function scheduleParse() {
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
      el.openShortLink.href = expanded;
      el.expandLink.textContent = "Retry expand";
      el.shortLinkActions.hidden = false;
      setMessage(result.error, "error");
    }
  } catch (error) {
    if (activeLookup === lookup) {
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

function publishMetadata(packet) {
  navigator.mediaSession.metadata = new MediaMetadata({ title: packet.title, artist: packet.artist, album: packet.album });
  try { navigator.mediaSession.playbackState = "playing"; } catch { }
}

function clearMediaSession() {
  try {
    navigator.mediaSession.metadata = null;
    navigator.mediaSession.playbackState = "none";
  } catch { }
}

function stopSendProgress() {
  if (sendRafId) cancelAnimationFrame(sendRafId);
  sendRafId = 0;
}

function tickSendProgress() {
  if (!sending) return;
  const totalMs = sendSeconds * 1000;
  const elapsed = Math.max(0, performance.now() - sendStartMs);
  const pct = Math.min(100, (elapsed / totalMs) * 100);
  const remaining = Math.max(1, Math.ceil((totalMs - elapsed) / 1000));
  el.sendProgressFill.style.width = `${pct.toFixed(1)}%`;
  el.sendSubtext.textContent = `Keep phone connected · ${remaining}s`;
  if (pct < 100) sendRafId = requestAnimationFrame(tickSendProgress);
}

function showSent() {
  stopSendProgress();
  el.sendButton.classList.remove("sending");
  el.sendButton.classList.add("sent");
  el.sendProgressFill.style.width = "100%";
  el.sendIcon.innerHTML = ICONS.check;
  el.sendButton.disabled = !currentCoords() || !mediaSupported();
  el.sendLabel.textContent = "Sent to ClioPlay";
  el.sendSubtext.textContent = "Check the destination on your screen";
  setBtStatus("sent", "Sent");
  vibrate([14, 40, 14]);
  clearTimeout(sentTimer);
  sentTimer = setTimeout(() => {
    el.sendButton.classList.remove("sent");
    el.sendProgressFill.style.width = "0%";
    el.sendIcon.innerHTML = ICONS.send;
    el.sendLabel.textContent = "Send to ClioPlay";
    setBtStatus(mediaSupported() ? "ready" : "error", mediaSupported() ? "Ready" : "Unsupported");
    updateDestination(currentProvider);
  }, 2400);
}

async function transmit() {
  const coords = currentCoords();
  if (sending || !coords || !mediaSupported()) return;
  sending = true;
  clearTimeout(sentTimer);
  stopSendProgress();
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

  try {
    publishMetadata(packet);
    await el.txAudio.play();
    publishMetadata(packet);
    sendStartMs = performance.now();
    sendRafId = requestAnimationFrame(tickSendProgress);
  } catch (error) {
    sending = false;
    stopSendProgress();
    clearMediaSession();
    el.sendButton.classList.remove("sending");
    el.sendProgressFill.style.width = "0%";
    el.sendIcon.innerHTML = ICONS.send;
    el.sendButton.disabled = !currentCoords() || !mediaSupported();
    el.sendLabel.textContent = "Send to ClioPlay";
    el.sendSubtext.textContent = "Tap to try again";
    setBtStatus("ready", "Ready");
    setMessage(`Could not start Bluetooth media transfer: ${error?.message || error}`, "error");
  }
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
el.txAudio.addEventListener("ended", () => {
  if (!sending) return;
  sending = false;
  clearMediaSession();
  if (canStorePlaces && pendingSentPlace) {
    recentPlaces = recordRecent(localStorage, pendingSentPlace);
    renderPlaces();
  }
  pendingSentPlace = null;
  showSent();
});

for (const navBtn of [el.navSend, el.navPlaces, el.navSettings]) {
  navBtn.addEventListener("click", () => switchTab(navBtn.dataset.tab));
}
el.quickPlacesAll.addEventListener("click", () => switchTab("places"));

el.manualCoordsToggle.addEventListener("click", () => {
  const opening = el.manualCoordsPanel.hidden;
  el.manualCoordsPanel.hidden = !opening;
  el.manualCoordsToggle.setAttribute("aria-expanded", String(opening));
  if (opening) el.latInput.focus();
});

el.clearInputButton.addEventListener("click", clearAllInputs);

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

el.sendButton.addEventListener("click", transmit);
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
  const params = new URLSearchParams(location.search);
  const shared = [params.get("title"), params.get("text"), params.get("url")].filter(Boolean).join("\n").trim();
  if (!shared) return;
  el.destinationInput.value = shared;
  autoResizeInput();
  parseInput();
  history.replaceState({}, "", location.pathname);
}

if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => {});
if (!mediaSupported()) {
  setBtStatus("error", "Unsupported");
  setMessage("This browser does not support Bluetooth media metadata transfers.", "error");
} else {
  setBtStatus("ready", "Ready");
}
loadPreferences();
setSendAction("N");
renderPlaces();
updateInstallUi();
consumeShareTarget();
