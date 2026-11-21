import { parseDestination, buildPacket, sanitiseAvrcpName, validCoords } from "./parser.js?v=20261121";

import { expandMapLink } from "./short-links.js?v=20261121";
import {
  RECENT_KEY, SAVED_KEY, RECENT_MAX, SAVED_MAX,
  storageAvailable, loadPlaces, recordRecent, clearRecents,
  findSavedIndex, savePlace, removeSavedPlace
} from "./places-store.js?v=20261121";

const resolverEndpoint = document.querySelector('meta[name="map-link-resolver"]')?.content.trim();
const $ = id => document.getElementById(id);
const el = {
  destinationInput: $("destinationInput"),
  pasteButton: $("pasteButton"),
  parseMessage: $("parseMessage"),
  shortLinkActions: $("shortLinkActions"),
  expandLink: $("expandLink"),
  openShortLink: $("openShortLink"),
  destinationCard: $("destinationCard"),
  sourceReadout: $("sourceReadout"),
  previewName: $("previewName"),
  previewCoords: $("previewCoords"),
  savePlaceButton: $("savePlaceButton"),
  nameInput: $("nameInput"),
  latInput: $("latInput"),
  lonInput: $("lonInput"),
  sendButton: $("sendButton"),
  sendSubtext: $("sendSubtext"),
  routeNewButton: $("routeNewButton"),
  addStopButton: $("addStopButton"),
  durationSelect: $("durationSelect"),
  placesCard: $("placesCard"),
  savedTabButton: $("savedTabButton"),
  recentTabButton: $("recentTabButton"),
  clearRecentsButton: $("clearRecentsButton"),
  placesList: $("placesList"),
  placesEmpty: $("placesEmpty"),
  txAudio: $("txAudio"),
  installButton: $("installButton")
};

let deferredInstall = null;
let audioObjectUrl = null;
let parseTimer = null;
let shortDestination = null;
let activeLookup = null;
let sendAction = "N";
let sending = false;
let sentTimer = null;
const canStorePlaces = storageAvailable();
let savedPlaces = canStorePlaces ? loadPlaces(localStorage, SAVED_KEY, SAVED_MAX) : [];
let recentPlaces = canStorePlaces ? loadPlaces(localStorage, RECENT_KEY, RECENT_MAX) : [];
let activePlacesTab = savedPlaces.length ? "saved" : "recent";
let pendingSentPlace = null;

function stored(key, fallback) {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}
function remember(key, value) {
  try { localStorage.setItem(key, value); } catch { }
}

function mediaSupported() {
  return "mediaSession" in navigator && "MediaMetadata" in window;
}

function loadTransferDuration() {
  const saved = Number(stored("clp-send-seconds", "4"));
  const allowed = [1, 2, 3, 4, 5, 8];
  const seconds = allowed.includes(saved) ? saved : 4;
  el.durationSelect.value = String(seconds);
  return seconds;
}

function transferDuration() {
  const seconds = Number(el.durationSelect.value);
  return [1, 2, 3, 4, 5, 8].includes(seconds) ? seconds : 4;
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

function updateSaveButton(coords) {
  if (!canStorePlaces || !coords) {
    el.savePlaceButton.hidden = true;
    return;
  }
  const idx = findSavedIndex(savedPlaces, coords.lat, coords.lon);
  const isSaved = idx >= 0;
  el.savePlaceButton.hidden = false;
  el.savePlaceButton.classList.toggle("saved", isSaved);
  el.savePlaceButton.textContent = isSaved ? "Saved" : "Save";
  el.savePlaceButton.setAttribute("aria-pressed", String(isSaved));
}

function loadQuickPlace(entry, sourceLabel) {
  clearTimeout(parseTimer);
  resetShortLink();
  el.destinationInput.value = "";
  el.latInput.value = entry.lat.toFixed(6);
  el.lonInput.value = entry.lon.toFixed(6);
  el.nameInput.value = entry.name || "Phone destination";
  if (entry.action === "S" || entry.action === "N") setSendAction(entry.action);
  setMessage(`${sourceLabel} destination ready.`, "success");
  updateDestination(sourceLabel);
}

function renderPlaces() {
  if (!canStorePlaces || (!savedPlaces.length && !recentPlaces.length)) {
    el.placesCard.hidden = true;
    return;
  }
  if (activePlacesTab === "saved" && !savedPlaces.length && recentPlaces.length) activePlacesTab = "recent";
  if (activePlacesTab === "recent" && !recentPlaces.length && savedPlaces.length) activePlacesTab = "saved";

  const isSavedTab = activePlacesTab === "saved";
  el.placesCard.hidden = false;
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
    el.placesEmpty.textContent = isSavedTab ? "No saved places yet." : "No recent sends yet.";
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
    loadBtn.append(title, coords);
    loadBtn.addEventListener("click", () => loadQuickPlace(item, isSavedTab ? "Saved place" : "Recent"));
    li.appendChild(loadBtn);
    if (isSavedTab) {
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "place-remove";
      removeBtn.textContent = "×";
      removeBtn.setAttribute("aria-label", `Remove ${item.name}`);
      removeBtn.addEventListener("click", () => {
        savedPlaces = removeSavedPlace(localStorage, i);
        updateSaveButton(currentCoords());
        renderPlaces();
      });
      li.appendChild(removeBtn);
    }
    el.placesList.appendChild(li);
  }
}

function updateDestination(provider = "Destination") {
  const coords = currentCoords();
  if (!coords) {
    el.destinationCard.hidden = true;
    el.savePlaceButton.hidden = true;
    el.sendButton.disabled = true;
    el.sendSubtext.textContent = "Choose a destination first";
    return;
  }

  const name = el.nameInput.value.trim() || "Phone destination";
  el.sourceReadout.textContent = provider;
  el.previewName.textContent = name;
  el.previewCoords.textContent = `${coords.lat.toFixed(6)}, ${coords.lon.toFixed(6)}`;
  el.destinationCard.hidden = false;
  updateSaveButton(coords);
  el.sendButton.disabled = sending || !mediaSupported();
  if (!sending) el.sendSubtext.textContent = mediaSupported() ? "Ready to send" : "Browser not supported";
}

function applyParsed(result) {
  el.latInput.value = result.lat.toFixed(6);
  el.lonInput.value = result.lon.toFixed(6);
  el.nameInput.value = result.name || "Phone destination";

  let note = `${result.provider} destination ready.`;
  if (result.confidence === "map-center") note = "This link points to the visible map centre. Check the coordinates before sending.";
  else if (result.confidence === "heuristic") note = "Coordinates found in the link. Check them before sending.";

  const simplified = sanitiseAvrcpName(el.nameInput.value);
  if (simplified !== el.nameInput.value.trim().normalize("NFC")) note += " The name will be shortened to fit ClioPlay's 40-character limit.";
  setMessage(note, result.confidence === "exact" ? "success" : "");
  updateDestination(result.provider);
}

function clearDestination() {
  el.latInput.value = "";
  el.lonInput.value = "";
  el.nameInput.value = "";
  el.destinationCard.hidden = true;
  el.sendButton.disabled = true;
  el.sendSubtext.textContent = "Choose a destination first";
}

function resetShortLink() {
  activeLookup?.abort();
  activeLookup = null;
  shortDestination = null;
  el.shortLinkActions.hidden = true;
  el.openShortLink.removeAttribute("href");
  el.expandLink.disabled = false;
}

function parseInput() {
  clearTimeout(parseTimer);
  resetShortLink();
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
    el.shortLinkActions.hidden = false;
    setMessage(resolverEndpoint
      ? `Expand this ${result.provider} short link to preview the destination.`
      : result.error);
  } else if (el.destinationInput.value.trim()) setMessage(result.error, "error");
  else setMessage("Paste a destination to begin.");
}

function scheduleParse() {
  resetShortLink();
  clearDestination();
  clearTimeout(parseTimer);
  parseTimer = setTimeout(parseInput, 180);
}

async function resolveShortDestination() {
  if (!shortDestination || !resolverEndpoint || activeLookup) return;
  const source = shortDestination;
  const lookup = new AbortController();
  activeLookup = lookup;
  const timeout = setTimeout(() => lookup.abort(), 7500);
  el.expandLink.disabled = true;
  setMessage(`Expanding the ${source.provider} link…`);
  try {
    const expanded = await expandMapLink(source.shortLink, resolverEndpoint, lookup.signal);
    if (activeLookup !== lookup) return;
    const result = parseDestination(expanded);
    if (result.ok) {
      resetShortLink();
      applyParsed({ ...result, name: result.name || source.sharedName });
    } else setMessage(result.error, "error");
  } catch {
    if (activeLookup === lookup) {
      setMessage("Could not expand this link. Open it in a browser and paste the address-bar URL or pin coordinates.", "error");
    }
  } finally {
    clearTimeout(timeout);
    if (activeLookup === lookup) {
      activeLookup = null;
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

function showSent() {
  el.sendButton.classList.add("sent");
  el.sendButton.disabled = !currentCoords() || !mediaSupported();
  el.sendButton.querySelector("strong").textContent = "Transfer finished";
  el.sendSubtext.textContent = "Check the destination on ClioPlay";
  clearTimeout(sentTimer);
  sentTimer = setTimeout(() => {
    el.sendButton.classList.remove("sent");
    el.sendButton.querySelector("strong").textContent = "Send to ClioPlay";
    updateDestination(el.sourceReadout.textContent || "Destination");
  }, 2200);
}

async function transmit() {
  const coords = currentCoords();
  if (sending || !coords || !mediaSupported()) return;
  sending = true;
  clearTimeout(sentTimer);
  el.sendButton.classList.remove("sent");

  const packet = buildPacket(coords.lat, coords.lon, el.nameInput.value.trim(), nextSequence(), sendAction);
  pendingSentPlace = { name: el.nameInput.value.trim() || "Phone destination", lat: coords.lat, lon: coords.lon, action: sendAction };
  if (audioObjectUrl) URL.revokeObjectURL(audioObjectUrl);
  audioObjectUrl = URL.createObjectURL(makeSilentWav(transferDuration()));
  el.txAudio.src = audioObjectUrl;
  el.txAudio.volume = 1;

  el.sendButton.disabled = true;
  el.sendButton.querySelector("strong").textContent = "Sending…";
  el.sendSubtext.textContent = "Keep the phone connected";

  try {
    publishMetadata(packet);
    await el.txAudio.play();
    publishMetadata(packet);
  } catch (error) {
    sending = false;
    clearMediaSession();
    el.sendButton.disabled = !currentCoords() || !mediaSupported();
    el.sendButton.querySelector("strong").textContent = "Send to ClioPlay";
    el.sendSubtext.textContent = "Try again";
    setMessage(`The browser could not start the Bluetooth media transfer: ${error?.message || error}`, "error");
  }
}

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
el.savePlaceButton.addEventListener("click", () => {
  const coords = currentCoords();
  if (!canStorePlaces || !coords) return;
  const idx = findSavedIndex(savedPlaces, coords.lat, coords.lon);
  if (idx >= 0) {
    savedPlaces = removeSavedPlace(localStorage, idx);
  } else {
    savedPlaces = savePlace(localStorage, { name: el.nameInput.value.trim() || "Phone destination", lat: coords.lat, lon: coords.lon });
    activePlacesTab = "saved";
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
});
el.sendButton.addEventListener("click", transmit);
el.routeNewButton.addEventListener("click", () => setSendAction("N"));
el.addStopButton.addEventListener("click", () => setSendAction("S"));
el.durationSelect.addEventListener("change", () => {
  remember("clp-send-seconds", String(transferDuration()));
});
el.destinationInput.addEventListener("input", scheduleParse);
el.expandLink.addEventListener("click", resolveShortDestination);
el.nameInput.addEventListener("input", () => updateDestination(el.sourceReadout.textContent || "Destination"));
el.latInput.addEventListener("input", () => {
  clearTimeout(parseTimer);
  resetShortLink();
  updateDestination("Coordinates");
  if (currentCoords()) setMessage("Coordinates ready.", "success");
});
el.lonInput.addEventListener("input", () => {
  clearTimeout(parseTimer);
  resetShortLink();
  updateDestination("Coordinates");
  if (currentCoords()) setMessage("Coordinates ready.", "success");
});

el.pasteButton.addEventListener("click", async () => {
  try {
    el.destinationInput.value = await navigator.clipboard.readText();
    parseInput();
  } catch {
    setMessage("Clipboard access is unavailable. Long-press the field and paste normally.", "error");
    el.destinationInput.focus();
  }
});

window.addEventListener("beforeinstallprompt", event => {
  event.preventDefault();
  deferredInstall = event;
  el.installButton.hidden = false;
});
el.installButton.addEventListener("click", async () => {
  if (!deferredInstall) return;
  deferredInstall.prompt();
  await deferredInstall.userChoice;
  deferredInstall = null;
  el.installButton.hidden = true;
});

function consumeShareTarget() {
  const params = new URLSearchParams(location.search);
  const shared = [params.get("title"), params.get("text"), params.get("url")].filter(Boolean).join("\n").trim();
  if (!shared) return;
  el.destinationInput.value = shared;
  parseInput();
  history.replaceState({}, "", location.pathname);
}

if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => {});
if (!mediaSupported()) setMessage("This browser does not support the media feature ClioPlay Send needs.", "error");
loadTransferDuration();
setSendAction("N");
renderPlaces();
consumeShareTarget();
