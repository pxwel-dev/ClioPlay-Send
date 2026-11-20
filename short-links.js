// Keep this shared by the browser and the redirect service.
function secureMapUrl(url) {
  return url.protocol === "https:" && !url.username && !url.password && !url.port;
}

export function shortMapProvider(url) {
  if (!secureMapUrl(url)) return "";
  const host = url.hostname;
  if ((host === "maps.app.goo.gl" && /^\/[A-Za-z0-9_-]+\/?$/.test(url.pathname)) ||
      (host === "goo.gl" && /^\/maps\/[A-Za-z0-9_-]+\/?$/.test(url.pathname))) return "Google Maps";
  if ((host === "maps.apple" || host.endsWith(".maps.apple")) &&
      /^\/p\/[A-Za-z0-9_~-]+\/?$/.test(url.pathname)) return "Apple Maps";
  return "";
}

export function expandedMapUrl(url, provider) {
  if (!secureMapUrl(url)) return false;
  if (provider === "Apple Maps") return url.hostname === "maps.apple.com";
  if (provider !== "Google Maps") return false;
  const hosts = ["google.com", "google.co.uk", "google.fr", "google.de", "google.ca", "google.com.au"];
  return hosts.some(host => url.hostname === host || url.hostname === "www." + host || url.hostname === "maps." + host) &&
    (url.pathname === "/maps" || url.pathname.startsWith("/maps/") || url.hostname.startsWith("maps.google."));
}

export async function expandMapLink(link, endpoint, signal) {
  const provider = shortMapProvider(new URL(link));
  if (!provider) throw new Error("Unsupported short link");
  const response = await fetch(endpoint, {
    method: "POST",
    body: link,
    signal,
    credentials: "omit",
    cache: "no-store",
    redirect: "error",
    referrerPolicy: "no-referrer"
  });
  if (!response.ok) throw new Error("Short link could not be expanded");
  const { url } = await response.json();
  if (!expandedMapUrl(new URL(url), provider)) throw new Error("Unexpected map link");
  return url;
}
