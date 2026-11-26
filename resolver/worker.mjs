import {
  cleanShortMapUrl,
  expandedMapUrl,
  hasMapCoordinates,
  normalizeShortMapUrl,
  shortMapProvider,
  unwrapIntermediateUrl
} from "../short-links.js";

const MAX_INPUT = 2048;
const MAX_HOPS = 6;
const MAX_LOCATION = 8192;
const REDIRECT = new Set([301, 302, 303, 307, 308]);

function allowedOrigins(env) {
  const raw = env?.SEND_ORIGIN || "https://pxwel-dev.github.io";
  return raw.split(",").map(s => s.trim()).filter(Boolean);
}

async function readLink(request) {
  const reader = request.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let bytes = 0, link = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return (link + decoder.decode()).trim();
    bytes += value.length;
    if (bytes > MAX_INPUT) {
      await reader.cancel();
      return "";
    }
    link += decoder.decode(value, { stream: true });
  }
}

function unwrapAll(url, provider) {
  let current = url;
  for (let i = 0; i < 3; i++) {
    const unwrapped = unwrapIntermediateUrl(current, provider);
    if (!unwrapped || unwrapped.href === current.href) break;
    current = unwrapped;
  }
  return current;
}

export async function resolveRedirects(url, provider, fetcher, signal) {
  const seen = new Set();
  let current = unwrapAll(url, provider);
  let fallbackExpanded = "";

  if (expandedMapUrl(current, provider)) {
    if (hasMapCoordinates(current, provider)) return current.href;
    fallbackExpanded = current.href;
  }

  for (let hop = 0; hop < MAX_HOPS; hop++) {
    const canFetch = shortMapProvider(current) === provider || expandedMapUrl(current, provider);
    if (!canFetch || seen.has(current.href)) break;
    seen.add(current.href);

    let response;
    try {
      response = await fetcher(current.href, {
        redirect: "manual",
        signal,
        headers: { "Accept-Language": "en" }
      });
    } catch (error) {
      if (fallbackExpanded) return fallbackExpanded;
      throw error;
    }

    const location = response.headers.get("Location");
    if (response.body) await response.body.cancel();
    if (!REDIRECT.has(response.status) || !location || location.length > MAX_LOCATION) break;

    let next;
    try {
      next = new URL(location, current);
    } catch {
      break;
    }

    if (next.protocol === "http:") {
      const upgraded = new URL(next.href);
      upgraded.protocol = "https:";
      if (shortMapProvider(upgraded) === provider || expandedMapUrl(upgraded, provider)) next = upgraded;
    }

    next = unwrapAll(next, provider);

    if (expandedMapUrl(next, provider)) {
      if (hasMapCoordinates(next, provider)) return next.href;
      fallbackExpanded = next.href;
      current = next;
      continue;
    }

    if (shortMapProvider(next) === provider) {
      current = cleanShortMapUrl(next, provider);
      continue;
    }

    break;
  }

  return fallbackExpanded;
}

export function resolver(fetcher = fetch) {
  return async (request, env) => {
    const origin = request.headers.get("Origin");
    const allowed = allowedOrigins(env);
    const headers = { "Cache-Control": "no-store", "Vary": "Origin" };
    const reply = (status, data) => Response.json(data, { status, headers });

    if (!origin || !allowed.includes(origin)) return reply(403, { error: "Origin not allowed" });
    headers["Access-Control-Allow-Origin"] = origin;

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          ...headers,
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Max-Age": "86400"
        }
      });
    }

    if (request.method !== "POST") return reply(405, { error: "Use POST" });
    if (!/^text\/plain\s*(?:;|$)/i.test(request.headers.get("Content-Type") || "")) {
      return reply(415, { error: "Use a plain-text map URL" });
    }

    const raw = await readLink(request);
    if (!raw) return reply(400, { error: "Invalid map URL" });

    let parsed;
    try { parsed = new URL(raw); }
    catch { return reply(400, { error: "Invalid map URL" }); }

    const url = normalizeShortMapUrl(parsed);
    if (!url) return reply(400, { error: "Unsupported short link" });
    const provider = shortMapProvider(url);
    const cleaned = cleanShortMapUrl(url, provider);

    try {
      const final = await resolveRedirects(cleaned, provider, fetcher, AbortSignal.timeout(7000));
      if (final) return reply(200, { url: final });
    } catch {
      return reply(502, { error: "Map provider unavailable" });
    }
    return reply(422, { error: "No supported map redirect" });
  };
}

export default { fetch: resolver() };
