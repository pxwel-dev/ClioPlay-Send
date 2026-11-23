const DISMISSED_KEY = "clioplay-send-dismissed-release";
const VERSION = /^(?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*)){2,3}$/;
const REPO = "/pxwel-dev/ClioPlay/";

export function compareVersions(a, b) {
  if (typeof a !== "string" || !VERSION.test(a)) return -1;
  if (typeof b !== "string" || !VERSION.test(b)) return 1;
  const left = a.split(".").map(BigInt), right = b.split(".").map(BigInt);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const leftPart = left[i] ?? 0n, rightPart = right[i] ?? 0n;
    if (leftPart !== rightPart) return leftPart > rightPart ? 1 : -1;
  }
  return 0;
}

function safeUrl(value, prefix) {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.origin === "https://github.com" && !url.username && !url.password &&
      url.pathname.startsWith(REPO + prefix);
  } catch { return false; }
}

export function validRelease(data) {
  const short = (s, max) => typeof s === "string" && s.trim().length > 0 && s.length <= max;
  return Boolean(data && typeof data.version === "string" && VERSION.test(data.version) &&
    data.version.length <= 32 && short(data.title, 120) && Array.isArray(data.features) &&
    data.features.length > 0 && data.features.length <= 8 &&
    data.features.every(item => short(item, 240)) &&
    safeUrl(data.releaseUrl, "releases/tag/") && safeUrl(data.updateUrl, "blob/"));
}

export function initReleaseNotice({ doc = document, fetcher = fetch, storage } = {}) {
  const $ = id => doc.getElementById(id);
  const banner = $("releaseNotice"), toggle = $("releaseToggle"), dismiss = $("releaseDismiss");
  const details = $("releaseDetails"), reopen = $("releaseReopen");
  if (!banner || !toggle || !dismiss || !details || !reopen) return Promise.resolve(false);
  let dismissed = "";
  let release;
  try {
    storage = storage ?? globalThis.localStorage;
    dismissed = storage?.getItem(DISMISSED_KEY) || "";
  } catch { /* private browsing or storage disabled */ }

  function setExpanded(expanded) {
    details.hidden = !expanded;
    toggle.setAttribute("aria-expanded", String(expanded));
    $("releaseToggleHint").textContent = expanded ? "Hide details" : "See what's new";
  }

  toggle.addEventListener("click", () => setExpanded(details.hidden));
  dismiss.addEventListener("click", () => {
    if (!release) return;
    if (compareVersions(release.version, dismissed) > 0) dismissed = release.version;
    try { storage?.setItem(DISMISSED_KEY, dismissed); } catch { /* session-only dismissal */ }
    setExpanded(false);
    banner.hidden = true;
    // Return keyboard focus to the main content, without opening the phone keyboard.
    $("sendHeading")?.focus({ preventScroll: true });
  });
  reopen.addEventListener("click", () => {
    if (!release) return;
    banner.hidden = false;
    setExpanded(true);
    toggle.focus();
  });

  // Independent of the sender: an absent, invalid or unavailable announcement
  // never prevents destination parsing or Bluetooth transfers.
  return Promise.resolve().then(() => fetcher("./release.json", { cache: "no-store" }))
    .then(response => {
      if (!response.ok) throw new Error("Release metadata unavailable");
      return response.json();
    })
    .then(data => {
      if (!validRelease(data)) return false;
      release = data;
      $("releaseHeading").textContent = `v${data.version} (${data.title})`;
      const features = $("releaseFeatures");
      features.replaceChildren(...data.features.map(item => {
        const li = doc.createElement("li");
        li.textContent = item;
        return li;
      }));
      $("releaseLink").href = data.releaseUrl;
      $("releaseGuide").href = data.updateUrl;
      reopen.textContent = `Latest release: v${data.version}`;
      reopen.hidden = false;
      setExpanded(false);
      banner.hidden = compareVersions(data.version, dismissed) <= 0;
      return true;
    })
    .catch(() => false);
}

if (typeof document !== "undefined") initReleaseNotice();
