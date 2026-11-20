import { expandedMapUrl, shortMapProvider } from "../short-links.js";

const MAX_INPUT = 2048;
const REDIRECT = new Set([301, 302, 303, 307, 308]);

async function readLink(request) {
  const reader = request.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let bytes = 0, link = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return link + decoder.decode();
    bytes += value.length;
    if (bytes > MAX_INPUT) {
      await reader.cancel();
      return "";
    }
    link += decoder.decode(value, { stream: true });
  }
}

export async function resolveRedirects(url, provider, fetcher, signal) {
  const seen = new Set();
  for (let hop = 0; hop < 4; hop++) {
    if (shortMapProvider(url) !== provider || seen.has(url.href)) break;
    seen.add(url.href);
    const response = await fetcher(url.href, { redirect: "manual", signal });
    const location = response.headers.get("Location");
    if (response.body) await response.body.cancel();
    if (!REDIRECT.has(response.status) || !location || location.length > 8192) break;
    url = new URL(location, url);
    if (expandedMapUrl(url, provider)) return url.href;
  }
  return "";
}

export function resolver(fetcher = fetch) {
  return async (request, env) => {
    const origin = request.headers.get("Origin");
    const allowedOrigin = env?.SEND_ORIGIN || "https://pxwel-dev.github.io";
    const headers = { "Cache-Control": "no-store", "Vary": "Origin" };
    const reply = (status, data) => Response.json(data, { status, headers });
    if (origin !== allowedOrigin) return reply(403, { error: "Origin not allowed" });
    headers["Access-Control-Allow-Origin"] = allowedOrigin;
    if (request.method !== "POST") return reply(405, { error: "Use POST" });
    if (!/^text\/plain\s*(?:;|$)/i.test(request.headers.get("Content-Type") || "")) {
      return reply(415, { error: "Use a plain-text map URL" });
    }
    let url;
    try { url = new URL(await readLink(request)); }
    catch { return reply(400, { error: "Invalid map URL" }); }
    const provider = shortMapProvider(url);
    if (!provider) return reply(400, { error: "Unsupported short link" });
    // Strip share-tracking parameters and fragments before calling the map provider.
    url.search = "";
    url.hash = "";
    try {
      const final = await resolveRedirects(url, provider, fetcher, AbortSignal.timeout(5500));
      if (final) return reply(200, { url: final });
    } catch {
      return reply(502, { error: "Map provider unavailable" });
    }
    return reply(422, { error: "No supported map redirect" });
  };
}

export default { fetch: resolver() };
