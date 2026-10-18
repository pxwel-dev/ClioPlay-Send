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
    .replace(/_/g, " ")
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
  text = text.replace(/&(?:amp|#0*38|#x0*26);/gi, "&")
    .replace(/&(?:apos|#0*39|#x0*27);/gi, "'");
  // Shared links can contain an encoded whole URL, rather than encoded URL parts.
  for (let i = 0; i < 2 && !/https?:\/\//i.test(text) && /https?%(?:25)*3a/i.test(text); i++) {
    text = safeDecode(text);
  }
  const geo = text.match(/geo:-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?[^\s]*/i);
  if (geo) return geo[0].replace(/[.;]+$/, "");
  // Apostrophes are valid URL characters: cutting at Kareem's loses the pin.
  // Prefer a Markdown link target over its label, which may itself be a URL.
  const markdown = text.match(/\]\(\s*<?(?=https?:\/\/)/i);
  const start = markdown ? markdown.index + markdown[0].length : 0;
  const match = text.slice(start).match(/https?:\/\/[^\s<>"\[\]]+/i);
  if (!match) return "";
  let url = match[0];
  const opening = text[start + match.index - 1];
  const closing = { "'": "'", "“": "”", "‘": "’" }[opening];
  if (closing && url.endsWith(closing)) url = url.slice(0, -1);
  url = url.replace(/[.,;]+$/, "");
  // Remove wrapping punctuation without damaging parentheses within place names.
  while (url.endsWith(")") && (url.match(/\)/g) || []).length > (url.match(/\(/g) || []).length) {
    url = url.slice(0, -1).replace(/[.,;]+$/, "");
  }
  return url;
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
  let lat = Number(m[1]), lon = Number(m[2]);
  let name = "";
  if (m[3]) {
    const query = safeDecode(m[3]);
    const labelled = query.match(/^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?:\s*\((.+)\))?$/);
    if (labelled) {
      lat = Number(labelled[1]); lon = Number(labelled[2]);
      name = tidyName(labelled[3] || "");
    } else if (lat === 0 && lon === 0) return null;
  }
  if (!validCoords(lat, lon)) return null;
  return { lat, lon, name, confidence: "exact" };
}

function googleParse(u) {
  let coords = null, name = "", confidence = "exact";
  function coordinateQuery(value) {
    // A street address such as "50,52 Crossley Terrace" is not a coordinate pair.
    const match = safeDecode(value || "").trim().match(/^(?:loc:)?\s*(-?\d{1,3}(?:\.\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)(?:\s*\([^)]*\))?\s*$/i);
    return toCoords(match);
  }
  for (const key of ["destination", "query", "daddr", "q"]) {
    if (coords) break;
    coords = coordinateQuery(u.searchParams.get(key));
  }
  if (!coords) {
    const data = safeDecode(u.pathname + " " + (u.searchParams.get("data") || ""));
    const pairs = [...data.matchAll(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)(?=!|\/|\s|$)/g)];
    const unique = new Map();
    for (const pair of pairs) {
      const point = toCoords(pair);
      if (!point) return null;
      unique.set(`${point.lat},${point.lon}`, point);
    }
    if (unique.size === 1) coords = unique.values().next().value;
    else if (unique.size > 1) return { error: "This Google Maps link contains more than one location. Open the destination's own place page and copy that full URL." };
  }
  if (!coords) {
    for (const key of ["ll", "center"]) {
      coords = coordinateQuery(u.searchParams.get(key));
      if (coords) { confidence = "map-center"; break; }
    }
  }
  if (!coords) {
    const at = safeDecode(u.pathname).match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?:,|\/|$)/);
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
    if (mlat.trim() && mlon.trim() && validCoords(lat, lon)) return { lat, lon, name: "", confidence: "exact" };
  }
  const latText = u.searchParams.get("lat"), lonText = u.searchParams.get("lon");
  if (latText !== null && lonText !== null) {
    const lat = Number(latText), lon = Number(lonText);
    if (latText.trim() && lonText.trim() && validCoords(lat, lon)) return { lat, lon, name: "", confidence: "exact" };
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

  if (parsed?.error) return { ok: false, provider: source, error: parsed.error };
  if (!parsed) return { ok: false, provider: source, error: source === "Google Maps"
    ? "This Google Maps link does not expose usable coordinates. Open it in Google Maps, select the destination, then copy the full URL from the address bar."
    : `This ${source} link does not expose coordinates.` };
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
