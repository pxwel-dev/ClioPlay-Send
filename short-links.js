// Shared by the browser app and the Cloudflare Worker redirect resolver.
const GOOGLE_DOMAIN = /^(?:(?:www|maps|m)\.)?google\.(?:com|cat|[a-z]{2}|co\.[a-z]{2}|com\.[a-z]{2})$/;
const CONSENT_GOOGLE_DOMAIN = /^consent\.google\.(?:com|cat|[a-z]{2}|co\.[a-z]{2}|com\.[a-z]{2})$/;
const WAZE_HOSTS = new Set(["waze.com", "www.waze.com", "ul.waze.com"]);
const WAZE_GEOHASH_PATH = /^\/ul\/h[0-9b-hjkmnp-z]{6,12}\/?$/;
const GOOGLE_CID = /^\d{5,25}$/;
const GOOGLE_FTID = /^0x[0-9a-f]+:0x[0-9a-f]+$/i;
const STRICT_COORD_PAIR = /^(?:loc:)?\s*(-?\d{1,3}(?:\.\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)(?:\s*\([^)]*\))?\s*$/i;

function secureMapUrl(url) {
  return url.protocol === "https:" && !url.username && !url.password && !url.port;
}

function validPairText(value) {
  if (!value) return false;
  let decoded = value;
  try { decoded = decodeURIComponent(String(value).replace(/\+/g, " ")); } catch { }
  const match = decoded.trim().match(STRICT_COORD_PAIR);
  if (!match) return false;
  const lat = Number(match[1]), lon = Number(match[2]);
  return Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
}

export function isGoogleDomain(hostname) {
  return GOOGLE_DOMAIN.test(String(hostname || "").toLowerCase());
}

export function isConsentGoogleDomain(hostname) {
  return CONSENT_GOOGLE_DOMAIN.test(String(hostname || "").toLowerCase());
}

export function hasMapCoordinates(url, provider) {
  if (!url) return false;
  if (provider === "Google Maps") {
    for (const key of ["destination", "query", "daddr", "q", "viewpoint", "ll", "sll", "center"]) {
      if (validPairText(url.searchParams.get(key))) return true;
    }
    let combined = url.pathname + " " + (url.searchParams.get("data") || "") + " " + (url.searchParams.get("pb") || "");
    try { combined = decodeURIComponent(combined.replace(/\+/g, " ")); } catch { }
    if (/!3d-?\d+(?:\.\d+)?!4d-?\d+(?:\.\d+)?(?=!|\/|\s|$)/.test(combined)) return true;
    if (/!2d-?\d+(?:\.\d+)?!3d-?\d+(?:\.\d+)?(?=!|\/|\s|$)/.test(combined)) return true;
    if (/@-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?(?:,|\/|$)/.test(combined)) return true;
    const pathMatch = combined.match(/\/maps\/(?:search|place)\/(-?\d{1,3}(?:\.\d+)?\s*,\s*-?\d{1,3}(?:\.\d+)?)(?:\/|\?|$|\s)/i);
    if (pathMatch && validPairText(pathMatch[1])) return true;
    return false;
  }
  if (provider === "Apple Maps") {
    for (const key of ["coordinate", "destination", "daddr", "ll", "sll", "center", "q"]) {
      if (validPairText(url.searchParams.get(key))) return true;
    }
    return false;
  }
  if (provider === "Waze") {
    if (WAZE_GEOHASH_PATH.test(url.pathname)) return true;
    if (validPairText(url.searchParams.get("ll")) || validPairText(url.searchParams.get("latlng"))) return true;
    let to = url.searchParams.get("to") || "";
    try { to = decodeURIComponent(to); } catch { }
    if (/^ll\.-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?/i.test(to)) return true;
    return false;
  }
  return false;
}

function isGoogleIdRedirect(url) {
  const host = url.hostname.toLowerCase();
  if (!isGoogleDomain(host)) return false;
  const isMapsPath = url.pathname === "/maps" || url.pathname === "/maps/" || host.startsWith("maps.google.");
  if (!isMapsPath) return false;
  const cid = url.searchParams.get("cid") || "";
  const ftid = url.searchParams.get("ftid") || "";
  if (!GOOGLE_CID.test(cid) && !GOOGLE_FTID.test(ftid)) return false;
  return !hasMapCoordinates(url, "Google Maps");
}

export function shortMapProvider(url) {
  if (!secureMapUrl(url)) return "";
  const host = url.hostname.toLowerCase();
  const path = url.pathname;
  if (
    (host === "maps.app.goo.gl" && (/^\/[A-Za-z0-9_-]{3,128}\/?$/.test(path) || (path === "/" && url.searchParams.has("link")))) ||
    ((host === "goo.gl" || host === "www.goo.gl") && /^\/maps\/[A-Za-z0-9_-]{3,128}\/?$/.test(path)) ||
    (host === "share.google" && /^\/(?:maps\/)?[A-Za-z0-9_-]{3,128}\/?$/.test(path)) ||
    ((host === "g.page" || host === "www.g.page") && /^\/(?:r\/[A-Za-z0-9_-]{3,128}(?:\/review)?|[A-Za-z0-9._-]{2,128}(?:\/(?:share|review))?)\/?$/.test(path)) ||
    isGoogleIdRedirect(url)
  ) return "Google Maps";

  if ((host === "maps.apple" || host.endsWith(".maps.apple")) &&
      /^\/p\/[A-Za-z0-9_~.-]{3,128}\/?$/.test(path)) return "Apple Maps";

  if (WAZE_HOSTS.has(host) &&
      /^\/ul\/[A-Za-z0-9_-]{3,128}\/?$/.test(path) &&
      !WAZE_GEOHASH_PATH.test(path)) return "Waze";

  return "";
}

export function normalizeShortMapUrl(input) {
  let url;
  try {
    url = input instanceof URL ? new URL(input.href) : new URL(String(input || "").trim());
  } catch {
    return null;
  }
  if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password || url.port) {
    return null;
  }
  if (url.protocol === "http:") url.protocol = "https:";
  return shortMapProvider(url) ? url : null;
}

export function cleanShortMapUrl(url, provider = shortMapProvider(url)) {
  const clean = new URL(url.href);
  clean.hash = "";
  const host = clean.hostname.toLowerCase();
  if (host === "maps.app.goo.gl" && clean.pathname === "/" && clean.searchParams.has("link")) {
    return clean;
  }
  if (host === "g.page" || host === "www.g.page") {
    const hasShare = clean.searchParams.has("share");
    clean.search = hasShare ? "?share" : "";
    return clean;
  }
  if (provider === "Google Maps" && isGoogleDomain(host)) {
    const cid = clean.searchParams.get("cid") || "";
    const ftid = clean.searchParams.get("ftid") || "";
    const next = new URLSearchParams();
    if (GOOGLE_CID.test(cid)) next.set("cid", cid);
    else if (GOOGLE_FTID.test(ftid)) next.set("ftid", ftid);
    clean.search = next.toString() ? `?${next.toString()}` : "";
    return clean;
  }
  // Strip share-tracking parameters and fragments before calling the map provider.
  clean.search = "";
  return clean;
}

export function expandedMapUrl(url, provider) {
  if (!secureMapUrl(url)) return false;
  const host = url.hostname.toLowerCase();
  if (provider === "Apple Maps") {
    if (host === "maps.apple.com" || host === "beta.maps.apple.com") return true;
    return host === "maps.apple" && !/^\/p\//.test(url.pathname) && (url.pathname.length > 1 || url.search.length > 1);
  }
  if (provider === "Waze") {
    if (!WAZE_HOSTS.has(host)) return false;
    return url.pathname.startsWith("/live-map") ||
      (url.pathname === "/ul" && url.search.length > 1) ||
      WAZE_GEOHASH_PATH.test(url.pathname);
  }
  if (provider !== "Google Maps") return false;
  return isGoogleDomain(host) && (
    url.pathname.startsWith("/maps/") ||
    (url.pathname === "/maps" && url.search.length > 1) ||
    (host.startsWith("maps.google.") && (url.pathname.length > 1 || url.search.length > 1))
  );
}

export function unwrapIntermediateUrl(url, provider = "Google Maps") {
  if (!url || !secureMapUrl(url) || provider !== "Google Maps") return null;
  const host = url.hostname.toLowerCase();
  let rawTarget = "";
  if (isConsentGoogleDomain(host)) {
    rawTarget = url.searchParams.get("continue") || "";
  } else if (isGoogleDomain(host) && url.pathname === "/url") {
    rawTarget = url.searchParams.get("q") || url.searchParams.get("url") || "";
  } else if (host === "maps.app.goo.gl" && url.searchParams.has("link")) {
    rawTarget = url.searchParams.get("link") || "";
  } else {
    return null;
  }
  if (!rawTarget || rawTarget.length > 8192) return null;
  let target;
  try {
    target = new URL(rawTarget);
  } catch {
    return null;
  }
  if (target.protocol === "http:") target.protocol = "https:";
  if (!secureMapUrl(target)) return null;
  if (
    expandedMapUrl(target, "Google Maps") ||
    shortMapProvider(target) === "Google Maps" ||
    isConsentGoogleDomain(target.hostname)
  ) return target;
  return null;
}

export async function expandMapLink(link, endpoint, signal) {
  const normalized = normalizeShortMapUrl(link);
  if (!normalized) throw new Error("Unsupported short link");
  const provider = shortMapProvider(normalized);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=UTF-8" },
    body: normalized.href,
    signal,
    credentials: "omit",
    cache: "no-store",
    redirect: "error",
    referrerPolicy: "no-referrer"
  });
  if (!response.ok) {
    let reason = "Short link could not be expanded";
    try {
      const payload = await response.json();
      if (payload && typeof payload.error === "string" && payload.error.trim()) reason = payload.error.trim();
    } catch { }
    const err = new Error(reason);
    err.status = response.status;
    throw err;
  }
  const { url } = await response.json();
  if (typeof url !== "string" || !expandedMapUrl(new URL(url), provider)) {
    throw new Error("Unexpected map link");
  }
  return url;
}
