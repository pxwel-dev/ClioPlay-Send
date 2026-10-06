import { parseDestination, buildPacket, sanitiseAvrcpName, validCoords } from "./parser.js";

const $ = id => document.getElementById(id);
const el = {
  destinationInput: $("destinationInput"),
  pasteButton: $("pasteButton"),
  parseMessage: $("parseMessage"),
  destinationCard: $("destinationCard"),
  sourceReadout: $("sourceReadout"),
  previewName: $("previewName"),
  previewCoords: $("previewCoords"),
  nameInput: $("nameInput"),
  latInput: $("latInput"),
  lonInput: $("lonInput"),
  sendButton: $("sendButton"),
  sendSubtext: $("sendSubtext"),
  txAudio: $("txAudio"),
  installButton: $("installButton")
};

const TRANSMIT_SECONDS = 1;
let deferredInstall = null;
let audioObjectUrl = null;
let parseTimer = null;

function mediaSupported() {
  return "mediaSession" in navigator && "MediaMetadata" in window;
}

function setMessage(text, type = "") {
  el.parseMessage.textContent = text;
  el.parseMessage.className = `message${type ? ` ${type}` : ""}`;
}

function nextSequence() {
  let n = Number(localStorage.getItem("clp-seq") || "0");
  n = (n + 1) & 0xffff;
  if (!n) n = 1;
  localStorage.setItem("clp-seq", String(n));
  return n;
}

function currentCoords() {
  const lat = Number(el.latInput.value), lon = Number(el.lonInput.value);
  return validCoords(lat, lon) ? { lat, lon } : null;
}

function updateDestination(provider = "Destination") {
  const coords = currentCoords();
  if (!coords) {
    el.destinationCard.hidden = true;
    el.sendButton.disabled = true;
    el.sendSubtext.textContent = "Choose a destination first";
    return;
  }

  const name = el.nameInput.value.trim() || "Phone destination";
  el.sourceReadout.textContent = provider;
  el.previewName.textContent = name;
  el.previewCoords.textContent = `${coords.lat.toFixed(6)}, ${coords.lon.toFixed(6)}`;
  el.destinationCard.hidden = false;
  el.sendButton.disabled = !mediaSupported();
  el.sendSubtext.textContent = mediaSupported() ? "Ready to send" : "Browser not supported";
}

function applyParsed(result) {
  el.latInput.value = result.lat.toFixed(6);
  el.lonInput.value = result.lon.toFixed(6);
  if (result.name) el.nameInput.value = result.name;
  else if (!el.nameInput.value.trim()) el.nameInput.value = "Phone destination";

  let note = `${result.provider} destination ready.`;
  if (result.confidence === "map-center") note = "This link points to the visible map centre. Check the coordinates before sending.";
  else if (result.confidence === "heuristic") note = "Coordinates found in the link. Check them before sending.";

  const simplified = sanitiseAvrcpName(el.nameInput.value);
  if (simplified !== el.nameInput.value.trim()) note += " The name will be simplified for the current ClioPlay Bluetooth connection.";
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

function parseInput() {
  const result = parseDestination(el.destinationInput.value);
  if (!result.ok) {
    if (el.destinationInput.value.trim()) clearDestination();
    if (el.destinationInput.value.trim()) setMessage(result.error, "error");
    else setMessage("Paste a destination to begin.");
    return;
  }
  applyParsed(result);
}

function scheduleParse() {
  clearTimeout(parseTimer);
  parseTimer = setTimeout(parseInput, 180);
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
  el.sendButton.disabled = false;
  el.sendButton.querySelector("strong").textContent = "Sent to ClioPlay";
  el.sendSubtext.textContent = "Send again if needed";
  setTimeout(() => {
    el.sendButton.classList.remove("sent");
    el.sendButton.querySelector("strong").textContent = "Send to ClioPlay";
    el.sendSubtext.textContent = "Ready to send";
  }, 2200);
}

async function transmit() {
  const coords = currentCoords();
  if (!coords || !mediaSupported()) return;

  const packet = buildPacket(coords.lat, coords.lon, el.nameInput.value.trim(), nextSequence());
  if (audioObjectUrl) URL.revokeObjectURL(audioObjectUrl);
  audioObjectUrl = URL.createObjectURL(makeSilentWav(TRANSMIT_SECONDS));
  el.txAudio.src = audioObjectUrl;
  el.txAudio.volume = 1;

  publishMetadata(packet);
  el.sendButton.disabled = true;
  el.sendButton.querySelector("strong").textContent = "Sending…";
  el.sendSubtext.textContent = "Keep the phone connected";

  try {
    await el.txAudio.play();
    publishMetadata(packet);
  } catch (error) {
    clearMediaSession();
    el.sendButton.disabled = false;
    el.sendButton.querySelector("strong").textContent = "Send to ClioPlay";
    el.sendSubtext.textContent = "Try again";
    setMessage(`The browser could not start the Bluetooth media transfer: ${error?.message || error}`, "error");
  }
}

el.txAudio.addEventListener("ended", () => {
  clearMediaSession();
  showSent();
});
el.sendButton.addEventListener("click", transmit);
el.destinationInput.addEventListener("input", scheduleParse);
el.destinationInput.addEventListener("paste", () => setTimeout(parseInput, 0));
el.nameInput.addEventListener("input", () => updateDestination(el.sourceReadout.textContent || "Destination"));
el.latInput.addEventListener("input", () => {
  updateDestination("Coordinates");
  if (currentCoords()) setMessage("Coordinates ready.", "success");
});
el.lonInput.addEventListener("input", () => {
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
consumeShareTarget();
