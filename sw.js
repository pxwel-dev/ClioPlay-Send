const CACHE = "clioplay-link-3.0.0";
const OWNED_PREFIXES = ["clioplay-send-", "clioplay-link-"];
const LOCALES = [
  "en", "fr", "es", "de", "it", "pt", "nl", "pl", "tr",
  "el", "uk", "ru", "ar", "zh-Hans", "ja", "ko", "hi", "he"
];
const ASSETS = [
  "./", "./index.html", "./styles.css", "./app.js", "./parser.js", "./short-links.js",
  "./protocol.js", "./qr-sync.js", "./qr-decode.js", "./qr-scanner.js", "./transport.js",
  "./mini-map.js", "./trip-rail.js", "./insights.js", "./i18n.js",
  "./places-store.js", "./trip-store.js", "./release-notice.js", "./release.json",
  "./manifest.webmanifest", "./icons/icon.svg", "./icons/icon-192.png", "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
  ...LOCALES.map(code => `./locales/${code}.json`)
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(
    ASSETS.map(path => new Request(new URL(path, self.registration.scope), { cache: "reload" }))
  )).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys
        .filter(key => OWNED_PREFIXES.some(p => key.startsWith(p)) && key !== CACHE)
        .map(key => caches.delete(key))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== location.origin) return;
  const asset = ASSETS.some(path => new URL(path, self.registration.scope).pathname === url.pathname);
  if (!asset) return;
  const key = new Request(url.origin + url.pathname);
  const releaseMetadata = url.pathname === new URL("./release.json", self.registration.scope).pathname;
  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (releaseMetadata && !response.ok) throw new Error("Release metadata unavailable");
        if (response.ok) {
          const copy = response.clone();
          event.waitUntil(caches.open(CACHE).then(cache => cache.put(key, copy)));
        }
        return response;
      })
      .catch(() => caches.open(CACHE).then(cache => cache.match(key)).then(hit => hit || (event.request.mode === "navigate" ? caches.match("./index.html") : Response.error())))
  );
});
