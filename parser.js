import {
  shortMapProvider,
  normalizeShortMapUrl,
  unwrapIntermediateUrl,
  isGoogleDomain,
  isConsentGoogleDomain
} from "./short-links.js?v=20261126";

const COORD_PAIR = /(-?\d{1,3}(?:\.\d+)?)\s*[,; ]\s*(-?\d{1,3}(?:\.\d+)?)/;
const STRICT_COORD_PAIR = /^(?:loc:)?\s*(-?\d{1,3}(?:\.\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)(?:\s*\([^)]*\))?\s*$/i;
const WAZE_GEOHASH_PATH = /^\/ul\/h([0-9b-hjkmnp-z]{6,12})\/?$/;

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

function coordinateQuery(value) {
  // A street address such as "50,52 Crossley Terrace" is not a coordinate pair.
  const match = safeDecode(value || "").trim().match(STRICT_COORD_PAIR);
  return toCoords(match);
}

function parseDmsCoords(value) {
  if (!value) return null;
  const text = safeDecode(value).trim();
  const dms = text.match(
    /^(\d{1,2})\s*°\s*(\d{1,2})?\s*(?:['′]\s*(\d{1,2}(?:\.\d+)?)\s*(?:["″]|'')?)?\s*([NS])[\s,;]+(\d{1,3})\s*°\s*(\d{1,2})?\s*(?:['′]\s*(\d{1,2}(?:\.\d+)?)\s*(?:["″]|'')?)?\s*([EW])$/i
  );
  if (dms) {
    const latDeg = Number(dms[1]), latMin = Number(dms[2] || 0), latSec = Number(dms[3] || 0);
    const lonDeg = Number(dms[5]), lonMin = Number(dms[6] || 0), lonSec = Number(dms[7] || 0);
    if (latMin >= 60 || latSec >= 60 || lonMin >= 60 || lonSec >= 60) return null;
    const lat = (latDeg + latMin / 60 + latSec / 3600) * (dms[4].toUpperCase() === "S" ? -1 : 1);
    const lon = (lonDeg + lonMin / 60 + lonSec / 3600) * (dms[8].toUpperCase() === "W" ? -1 : 1);
    return validCoords(lat, lon) ? { lat, lon } : null;
  }
  const cardinal = text.match(
    /^(\d{1,2}(?:\.\d+)?)\s*°?\s*([NS])[\s,;]+(\d{1,3}(?:\.\d+)?)\s*°?\s*([EW])$/i
  );
  if (cardinal) {
    const lat = Number(cardinal[1]) * (cardinal[2].toUpperCase() === "S" ? -1 : 1);
    const lon = Number(cardinal[3]) * (cardinal[4].toUpperCase() === "W" ? -1 : 1);
    return validCoords(lat, lon) ? { lat, lon } : null;
  }
  return null;
}

function parsePair(value) {
  if (!value) return null;
  return parseDmsCoords(value) || toCoords(safeDecode(value).replace(/~/g, ",").match(COORD_PAIR));
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
  if (!match) {
    const bare = text.match(
      /(?:^|[\s(<"'])((?:maps\.app\.goo\.gl|share\.google|(?:www\.)?goo\.gl\/maps|(?:www\.)?g\.page|maps\.apple(?:\.com)?|(?:www\.|ul\.)?waze\.com|(?:www\.)?(?:osm\.org|openstreetmap\.org))\/[^\s<>"\[\]]*)/i
    );
    if (!bare) return "";
    return ("https://" + bare[1]).replace(/[.,;)\]]+$/, "");
  }
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
    if (coordinateQuery(line) || parseDmsCoords(line)) continue;
    if (line.length <= 100) return tidyName(line);
  }
  return "";
}

function provider(host) {
  const h = host.toLowerCase();
  if (h === "maps.apple" || h.endsWith(".maps.apple") || h === "maps.apple.com" || h === "beta.maps.apple.com") {
    return "Apple Maps";
  }
  if (h === "maps.app.goo.gl" || h === "goo.gl" || h === "www.goo.gl" ||
      h === "share.google" || h === "g.page" || h === "www.g.page" ||
      isGoogleDomain(h) || isConsentGoogleDomain(h)) {
    return "Google Maps";
  }
  if (h === "waze.com" || h.endsWith(".waze.com")) return "Waze";
  if (h === "openstreetmap.org" || h.endsWith(".openstreetmap.org") || h === "osm.org" || h.endsWith(".osm.org")) {
    return "OpenStreetMap";
  }
  return "Map link";
}

function isPureShortUrl(url) {
  const host = url.hostname.toLowerCase();
  if (host === "maps.app.goo.gl" || host === "goo.gl" || host === "www.goo.gl" ||
      host === "share.google" || host === "g.page" || host === "www.g.page") {
    return true;
  }
  if ((host === "maps.apple" || host.endsWith(".maps.apple")) && /^\/p\//.test(url.pathname)) {
    return true;
  }
  return false;
}

function osmShortParse(url) {
  const match = url.pathname.match(/^\/go\/([A-Za-z0-9_~@]{1,11})[-=]{0,2}\/?$/);
  if (!match) return null;
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_~";
  let x = 0, y = 0;
  for (const char of match[1]) {
    const tile = alphabet.indexOf(char === "@" ? "~" : char);
    for (let shift = 4; shift >= 0; shift -= 2) {
      x = 2 * x + ((tile >> (shift + 1)) & 1);
      y = 2 * y + ((tile >> shift) & 1);
    }
  }
  const scale = 2 ** (3 * match[1].length);
  return {
    lat: 180 * y / scale - 90,
    lon: 360 * x / scale - 180,
    name: "",
    confidence: url.searchParams.has("m") ? "exact" : "map-center"
  };
}

function decodeGeohash(hash) {
  const alphabet = "0123456789bcdefghjkmnpqrstuvwxyz";
  let even = true;
  let latMin = -90, latMax = 90, lonMin = -180, lonMax = 180;
  for (const ch of hash) {
    const idx = alphabet.indexOf(ch);
    if (idx < 0) return null;
    for (let bit = 4; bit >= 0; bit--) {
      const mask = 1 << bit;
      if (even) {
        const mid = (lonMin + lonMax) / 2;
        if (idx & mask) lonMin = mid; else lonMax = mid;
      } else {
        const mid = (latMin + latMax) / 2;
        if (idx & mask) latMin = mid; else latMax = mid;
      }
      even = !even;
    }
  }
  const lat = (latMin + latMax) / 2;
  const lon = (lonMin + lonMax) / 2;
  return validCoords(lat, lon) ? { lat, lon } : null;
}

function geoParse(uri) {
  const m = uri.match(/^geo:(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?:;[^?]*)?(?:\?(.+))?$/i);
  if (!m) return null;
  let lat = Number(m[1]), lon = Number(m[2]);
  let name = "";
  if (m[3]) {
    const params = new URLSearchParams(m[3]);
    const qRaw = params.get("q");
    if (qRaw !== null) {
      const query = safeDecode(qRaw);
      const labelled = query.match(/^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?:\s*\((.+)\))?$/);
      if (labelled) {
        lat = Number(labelled[1]); lon = Number(labelled[2]);
        name = tidyName(labelled[3] || "");
      } else if (lat === 0 && lon === 0) return null;
    }
  }
  if (!validCoords(lat, lon)) return null;
  return { lat, lon, name, confidence: "exact" };
}

function uniqueDataPin(data, regex, swapLonLat = false) {
  const pairs = [...data.matchAll(regex)];
  if (!pairs.length) return { point: null, ambiguous: false, invalid: false };
  const unique = new Map();
  for (const pair of pairs) {
    const lat = Number(swapLonLat ? pair[2] : pair[1]);
    const lon = Number(swapLonLat ? pair[1] : pair[2]);
    if (!validCoords(lat, lon)) return { point: null, ambiguous: false, invalid: true };
    unique.set(`${lat},${lon}`, { lat, lon });
  }
  if (unique.size === 1) return { point: unique.values().next().value, ambiguous: false, invalid: false };
  return { point: null, ambiguous: true, invalid: false };
}

function googleParse(u) {
  let coords = null, name = "", confidence = "exact";
  for (const key of ["destination", "query", "daddr", "q", "viewpoint"]) {
    if (coords) break;
    coords = coordinateQuery(u.searchParams.get(key)) || parseDmsCoords(u.searchParams.get(key));
  }
  if (!coords) {
    const data = safeDecode(
      u.pathname + " " + (u.searchParams.get("data") || "") + " " + (u.searchParams.get("pb") || "")
    );
    const primary = uniqueDataPin(data, /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)(?=!|\/|\s|$)/g, false);
    if (primary.invalid) return null;
    if (primary.ambiguous) {
      return { error: "This Google Maps link contains more than one location. Open the destination's own place page and copy that full URL." };
    }
    if (primary.point) {
      coords = primary.point;
    } else {
      const alt = uniqueDataPin(data, /!2d(-?\d+(?:\.\d+)?)!3d(-?\d+(?:\.\d+)?)(?=!|\/|\s|$)/g, true);
      if (alt.invalid) return null;
      if (alt.ambiguous) {
        return { error: "This Google Maps link contains more than one location. Open the destination's own place page and copy that full URL." };
      }
      if (alt.point) coords = alt.point;
    }
  }
  if (!coords) {
    const seg = u.pathname.match(/\/maps\/(?:search|place)\/([^/]+)/i);
    if (seg) {
      const candidate = coordinateQuery(seg[1]) || parseDmsCoords(seg[1]);
      if (candidate) coords = candidate;
    }
  }
  if (!coords) {
    for (const key of ["ll", "sll", "center"]) {
      coords = coordinateQuery(u.searchParams.get(key));
      if (coords) { confidence = "map-center"; break; }
    }
  }
  if (!coords) {
    const at = safeDecode(u.pathname).match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?:,|\/|$)/);
    if (at) { coords = toCoords(at); confidence = "map-center"; }
  }
  const place = u.pathname.match(/\/place\/([^/]+)/i);
  if (place) {
    const rawPlace = place[1];
    if (!coordinateQuery(rawPlace) && !parseDmsCoords(rawPlace)) name = tidyName(rawPlace);
  }
  if (!name) {
    const q = u.searchParams.get("query") || u.searchParams.get("q");
    if (q && !coordinateQuery(q) && !parseDmsCoords(q)) name = tidyName(q);
  }
  return coords ? { ...coords, name, confidence } : null;
}

function appleParse(u) {
  let coords = null, confidence = "exact";
  for (const key of ["coordinate", "destination", "daddr", "ll", "sll"]) {
    coords = parsePair(u.searchParams.get(key));
    if (coords) break;
  }
  if (!coords) {
    coords = coordinateQuery(u.searchParams.get("q")) || parseDmsCoords(u.searchParams.get("q"));
  }
  if (!coords) {
    coords = parsePair(u.searchParams.get("center"));
    if (coords) confidence = "map-center";
  }
  const rawQ = u.searchParams.get("q") || "";
  const safeQ = rawQ && !coordinateQuery(rawQ) && !parseDmsCoords(rawQ) ? rawQ : "";
  const name = tidyName(
    u.searchParams.get("name") || safeQ || u.searchParams.get("query") || u.searchParams.get("address") || ""
  );
  return coords ? { ...coords, name, confidence } : null;
}

function wazeParse(u) {
  let coords = parsePair(u.searchParams.get("ll")) || parsePair(u.searchParams.get("latlng"));
  let confidence = "exact";
  if (!coords) {
    const to = safeDecode(u.searchParams.get("to") || "");
    const m = to.match(/^ll\.(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/i);
    if (m) coords = toCoords(m);
  }
  if (!coords) {
    const geo = u.pathname.match(WAZE_GEOHASH_PATH);
    if (geo) {
      coords = decodeGeohash(geo[1]);
      if (coords && geo[1].length < 7) confidence = "map-center";
    }
  }
  if (!coords) return null;
  let name = tidyName(u.searchParams.get("q") || "");
  if (!name && u.pathname.startsWith("/live-map/directions/")) {
    const parts = u.pathname.split("/").filter(Boolean);
    const tail = parts[parts.length - 1] || "";
    if (parts.length >= 4 && tail && !/^place\./i.test(tail) && !coordinateQuery(tail)) {
      name = tidyName(tail.replace(/-/g, " ")).replace(/(^|\s)\p{L}/gu, m => m.toUpperCase());
    }
  }
  return { ...coords, name, confidence };
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
  const route = u.searchParams.get("route");
  if (route) {
    const stops = route.split(";").map(s => coordinateQuery(s)).filter(Boolean);
    if (stops.length) return { ...stops[stops.length - 1], name: "", confidence: "exact" };
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
  if (!raw) return { ok: false, error: "Paste a map link or coordinates to begin." };

  const urlText = extractUrl(raw);
  if (urlText && /^geo:/i.test(urlText)) {
    const parsed = geoParse(urlText);
    return parsed
      ? { ok: true, ...parsed, name: parsed.name || sharedName(raw, urlText), provider: "Coordinates" }
      : { ok: false, error: "That location link does not contain valid coordinates." };
  }

  if (!urlText) {
    const lines = raw.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    let coords = null;
    for (const line of lines) {
      coords = parseDmsCoords(line) || coordinateQuery(line);
      if (coords) break;
    }
    if (!coords) coords = parsePair(raw);
    if (!coords) return { ok: false, error: "No usable coordinates were found." };
    const title = lines.length > 1 ? sharedName(raw, "") : "";
    return { ok: true, ...coords, name: title, provider: "Coordinates", confidence: "exact" };
  }

  let u;
  try { u = new URL(urlText); }
  catch { return { ok: false, error: "That map link is not valid." }; }

  // Unwrap Google consent walls, redirect wrappers, or Firebase dynamic map links locally.
  for (let i = 0; i < 2; i++) {
    const candidate = u.protocol === "http:" ? new URL(u.href.replace(/^http:/i, "https:")) : u;
    const unwrapped = unwrapIntermediateUrl(candidate, "Google Maps");
    if (!unwrapped || unwrapped.href === u.href) break;
    u = unwrapped;
  }

  const source = provider(u.hostname);
  const normalizedShort = normalizeShortMapUrl(u);
  if (normalizedShort && isPureShortUrl(normalizedShort)) {
    const shortSource = shortMapProvider(normalizedShort) || source;
    return {
      ok: false,
      provider: shortSource,
      shortLink: normalizedShort.href,
      sharedName: sharedName(raw, urlText),
      error: `${shortSource} shortened this link. Expand it or open it in your browser, then paste the full URL here.`
    };
  }

  let parsed;
  if (source === "Google Maps") parsed = googleParse(u);
  else if (source === "Apple Maps") parsed = appleParse(u);
  else if (source === "Waze") parsed = wazeParse(u);
  else if (source === "OpenStreetMap") parsed = u.pathname.startsWith("/go/") ? osmShortParse(u) : osmParse(u);
  else parsed = genericParse(u);

  if (parsed?.error) return { ok: false, provider: source, error: parsed.error };
  if (parsed) return { ok: true, ...parsed, name: parsed.name || sharedName(raw, urlText), provider: source };

  if (normalizedShort) {
    const shortSource = shortMapProvider(normalizedShort) || source;
    return {
      ok: false,
      provider: shortSource,
      shortLink: normalizedShort.href,
      sharedName: sharedName(raw, urlText),
      error: `${shortSource} needs to expand this link to find coordinates.`
    };
  }

  return {
    ok: false,
    provider: source,
    error: source === "Google Maps"
      ? "This Google Maps link does not expose usable coordinates. Open it in Google Maps, select the destination, then copy the full URL from the address bar."
      : `This ${source} link does not expose coordinates.`
  };
}

export function sanitiseAvrcpName(name) {
  const clean = String(name || "PHONE DESTINATION")
    .normalize("NFC")
    .replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200D\uFEFF]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return "PHONE DESTINATION";
  let out = "";
  let chars = 0;
  let bytes = 0;
  for (const ch of clean) {
    if (chars >= 40) break;
    const cp = ch.codePointAt(0);
    const len = cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
    if (bytes + len > 160) break;
    out += ch;
    chars++;
    bytes += len;
  }
  return out || "PHONE DESTINATION";
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
