const CACHE = "clioplay-send-release-notice-20261119";
const OWNED_PREFIX = "clioplay-send-";
const ASSETS = [
  "./", "./index.html", "./styles.css", "./app.js", "./parser.js",
  "./release-notice.js", "./release.json",
  "./manifest.webmanifest", "./icons/icon-192.png", "./icons/icon-512.png", "./icons/apple-touch-icon.png"
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(
    ASSETS.map(path => new Request(new URL(path, self.registration.scope), { cache: "reload" }))
  )).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith(OWNED_PREFIX) && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
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
