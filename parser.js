const COORD_PAIR = /(-?\d{1,3}(?:\.\d+)?)\s*[,; ]\s*(-?\d{1,3}(?:\.\d+)?)/;

export function validCoords(lat, lon) {
  return Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
}

function safeDecode(value) {
  try { return decodeURIComponent(String(value).replace(/\+/g, " ")); }
  catch { return String(value || ""); }
}

function tidyName(value) {
  return safeDecode(value || "")
    .replace(/[_+]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[-–—\s]+|[-–—\s]+$/g, "")
    .trim();
}

function toCoords(match) {
  if (!match) return null;
  const lat = Number(match[1]);
  const lon = Number(match[2]);
  return validCoords(lat, lon) ? { lat, lon } : null;
}

function parsePair(value) {
  if (!value) return null;
  return toCoords(safeDecode(value).replace(/~/g, ",").match(COORD_PAIR));
}

function extractUrl(text) {
  const geo = text.match(/geo:-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?[^\s]*/i);
  if (geo) return geo[0].replace(/[),.;]+$/, "");
  const match = text.match(/https?:\/\/[^\s<>"']+/i);
  return match ? match[0].replace(/[),.;]+$/, "") : "";
}

function sharedName(text, url) {
  for (const line of text.split(/\r?\n/).map(s => s.trim()).filter(Boolean)) {
    if (line === url || /^https?:\/\//i.test(line) || /^geo:/i.test(line)) continue;
    if (line.length <= 100) return tidyName(line);
  }
  return "";
}

function provider(host) {
  const h = host.toLowerCase();
  if (h === "maps.apple" || h.endsWith(".maps.apple") || h === "maps.apple.com") return "Apple Maps";
  if (h === "maps.app.goo.gl" || h === "goo.gl" || h.includes("google.")) return "Google Maps";
  if (h === "waze.com" || h.endsWith(".waze.com")) return "Waze";
  if (h === "openstreetmap.org" || h.endsWith(".openstreetmap.org") || h === "osm.org" || h.endsWith(".osm.org")) return "OpenStreetMap";
  return "Map link";
}

function isShortLink(url) {
  try {
    const u = new URL(url), h = u.hostname.toLowerCase();
    return h === "maps.apple" || h.endsWith(".maps.apple") || h === "maps.app.goo.gl" ||
      (h === "goo.gl" && u.pathname.startsWith("/maps")) ||
      ((h === "osm.org" || h.endsWith(".osm.org")) && u.pathname.startsWith("/go/"));
  } catch { return false; }
}

function geoParse(uri) {
  const m = uri.match(/^geo:(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?:\?q=([^&]+))?/i);
  if (!m) return null;
  const lat = Number(m[1]), lon = Number(m[2]);
  if (!validCoords(lat, lon)) return null;
  let name = "";
  if (m[3]) {
    const labelled = safeDecode(m[3]).match(/^-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?\s*\((.+)\)$/);
    if (labelled) name = tidyName(labelled[1]);
  }
  return { lat, lon, name, confidence: "exact" };
}

function googleParse(u) {
  let coords = null, name = "", confidence = "exact";
  const data = u.href.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
  if (data) coords = toCoords(data);
  for (const key of ["destination", "query", "daddr", "ll", "q", "center"]) {
    if (coords) break;
    coords = parsePair(u.searchParams.get(key));
    if (coords && key === "center") confidence = "map-center";
  }
  if (!coords) {
    const at = safeDecode(u.href).match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?:,|\/|$)/);
    if (at) { coords = toCoords(at); confidence = "map-center"; }
  }
  const place = u.pathname.match(/\/place\/([^/]+)/i);
  if (place) name = tidyName(place[1]);
  if (!name) {
    const q = u.searchParams.get("query") || u.searchParams.get("q");
    if (q && !parsePair(q)) name = tidyName(q);
  }
  return coords ? { ...coords, name, confidence } : null;
}

function appleParse(u) {
  let coords = null, confidence = "exact";
  for (const key of ["coordinate", "destination", "daddr", "ll"]) {
    coords = parsePair(u.searchParams.get(key));
    if (coords) break;
  }
  if (!coords) {
    coords = parsePair(u.searchParams.get("center"));
    if (coords) confidence = "map-center";
  }
  const name = tidyName(u.searchParams.get("name") || u.searchParams.get("q") || u.searchParams.get("query") || "");
  return coords ? { ...coords, name, confidence } : null;
}

function wazeParse(u) {
  let coords = parsePair(u.searchParams.get("ll"));
  if (!coords) {
    const to = safeDecode(u.searchParams.get("to") || "");
    const m = to.match(/^ll\.(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/i);
    if (m) coords = toCoords(m);
  }
  return coords ? { ...coords, name: tidyName(u.searchParams.get("q") || ""), confidence: "exact" } : null;
}

function osmParse(u) {
  const mlat = u.searchParams.get("mlat"), mlon = u.searchParams.get("mlon");
  if (mlat !== null && mlon !== null) {
    const lat = Number(mlat), lon = Number(mlon);
    if (validCoords(lat, lon)) return { lat, lon, name: "", confidence: "exact" };
  }
  const latText = u.searchParams.get("lat"), lonText = u.searchParams.get("lon");
  if (latText !== null && lonText !== null) {
    const lat = Number(latText), lon = Number(lonText);
    if (validCoords(lat, lon)) return { lat, lon, name: "", confidence: "exact" };
  }
  const hash = safeDecode(u.hash).match(/#map=\d+(?:\.\d+)?\/(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)/i);
  if (hash) {
    const coords = toCoords(hash);
    if (coords) return { ...coords, name: "", confidence: "map-center" };
  }
  return null;
}

function genericParse(u) {
  for (const key of ["coordinate", "coordinates", "destination", "daddr", "ll", "latlng", "q", "query", "center"]) {
    const coords = parsePair(u.searchParams.get(key));
    if (coords) return { ...coords, name: "", confidence: key === "center" ? "map-center" : "exact" };
  }
  const decoded = safeDecode(u.href);
  for (const match of decoded.matchAll(/(-?\d{1,3}(?:\.\d+)?)\s*[,~]\s*(-?\d{1,3}(?:\.\d+)?)/g)) {
    const coords = toCoords(match);
    if (coords) return { ...coords, name: "", confidence: "heuristic" };
  }
  return null;
}

export function parseDestination(input) {
  const raw = String(input || "").trim();
  if (!raw) return { ok: false, error: "Paste a destination to begin." };

  const urlText = extractUrl(raw);
  if (urlText && /^geo:/i.test(urlText)) {
    const parsed = geoParse(urlText);
    return parsed ? { ok: true, ...parsed, name: parsed.name || sharedName(raw, urlText), provider: "Coordinates" } : { ok: false, error: "That location link does not contain valid coordinates." };
  }

  if (!urlText) {
    const coords = parsePair(raw);
    return coords ? { ok: true, ...coords, name: "", provider: "Coordinates", confidence: "exact" } : { ok: false, error: "No usable coordinates were found." };
  }

  let u;
  try { u = new URL(urlText); }
  catch { return { ok: false, error: "That map link is not valid." }; }

  const source = provider(u.hostname);
  if (isShortLink(urlText)) {
    return {
      ok: false,
      provider: source,
      shortLink: true,
      error: `${source} shortened this link. Open it in your browser, then copy the full URL from the address bar and paste it here.`
    };
  }

  let parsed;
  if (source === "Google Maps") parsed = googleParse(u);
  else if (source === "Apple Maps") parsed = appleParse(u);
  else if (source === "Waze") parsed = wazeParse(u);
  else if (source === "OpenStreetMap") parsed = osmParse(u);
  else parsed = genericParse(u);

  if (!parsed) return { ok: false, provider: source, error: `This ${source} link does not expose coordinates.` };
  return { ok: true, ...parsed, name: parsed.name || sharedName(raw, urlText), provider: source };
}

export function sanitiseAvrcpName(name) {
  const clean = String(name || "PHONE DESTINATION")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/[^\x20-\x7E]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (clean || "PHONE DESTINATION").slice(0, 40);
}

function crc16Ccitt(text) {
  let crc = 0xffff;
  for (let i = 0; i < text.length; i++) {
    crc ^= text.charCodeAt(i) << 8;
    for (let bit = 0; bit < 8; bit++) crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc & 0xffff;
}

export function buildPacket(lat, lon, name, sequence, action = "N") {
  if (!validCoords(lat, lon)) throw new Error("Invalid coordinates");
  const intent = action === "S" ? "S" : "N";
  const latE5 = Math.round(lat * 100000), lonE5 = Math.round(lon * 100000);
  const seqHex = (sequence & 0xffff).toString(16).toUpperCase().padStart(4, "0");
  const body = `CLP2:${intent}:${latE5}:${lonE5}:${seqHex}`;
  const crc = crc16Ccitt(body).toString(16).toUpperCase().padStart(4, "0");
  const title = `${body}:${crc}`;
  if (title.length > 48) throw new Error("Destination packet is too long");
  return { title, artist: sanitiseAvrcpName(name), album: "CLIOPLAY-NAV" };
}
