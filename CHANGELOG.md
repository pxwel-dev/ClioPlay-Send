# Sender changes

## 26 November 2026 — Companion app redesign & bulletproof short-link resolver

- **Companion app UX (`index.html`, `styles.css`, `app.js`, `manifest.webmanifest`):**
  - Re-implemented ClioPlay Send as a frosted-glass companion PWA with a sticky top status bar (`Ready` / `Sending` / `Sent`), fixed bottom tab bar (**Send**, **Places**, **Settings**), safe-area insets, vector icons, and micro-toast feedback.
  - Added one-tap **Quick places** chips on **Send**, a live **40-char AVRCP counter** and pin-confidence badge (`Exact pin` / `Map centre`) on the destination card, and a tactile **Send to ClioPlay** button with an embedded live progress bar and countdown during transmission.
  - Added automatic short-link expansion on paste/share (with an **Auto-expand short links** toggle in **Settings**, plus `1s–8s` pill duration picker and standalone/iOS install guidance).
  - Dedicated **Places** tab with 1-tap reload into **Send**, quick-bookmarking on recent sends, and live tab badge counts.
- **Broadened, hardened short-link resolver & parser (`short-links.js`, `resolver/worker.mjs`, `parser.js`):**
  - Expanded Google Maps support to cover `maps.app.goo.gl`, `goo.gl/maps`, `share.google`, `g.page` (including `/r/` and `?share`), `?cid=` / `?ftid=` redirects, Firebase dynamic `maps.app.goo.gl/?link=…` (offline), and **all official regional Google ccTLDs** (`google.pl`, `google.es`, `google.it`, `google.co.jp`, etc. — no longer capped at 6 countries).
  - Unwrap EU/UK `consent.google.*` (`continue=`) and `google.*/url` (`q=`/`url=`) redirect bounces safely both in the Worker and locally offline, while rejecting off-provider redirect targets.
  - Follow multi-hop same-provider redirects (up to 6 hops, including `ftid`/`cid` hops when an intermediate Google Maps URL has no coordinates yet, with graceful fallback).
  - Added **Waze** offline Base32 geohash decoding (`waze.com/ul/h…`), Waze short-link redirect support (`waze.com/ul/…`), and Live Map destination-name parsing.
  - Added iOS 18+ Apple Maps apex domain (`maps.apple/…`) and `beta.maps.apple.com` support.
  - Added `OPTIONS` CORS preflight support, `http://` → `https://` upgrades for allowlisted shorteners, multi-origin `SEND_ORIGIN` allowlists, DMS & cardinal coordinate parsing, OpenStreetMap `/directions?route=…`, Google `!2d!3d` & `/maps/search/lat,lon`, RFC 5870 `geo:` URIs, and scheme-less map links.
  - Bumped PWA asset query versions (`?v=20261126`) and service worker cache (`clioplay-send-20261126-1`).

## 26 November 2026 — ClioPlay 2.2.7 announcement

- Update the release announcement notice (`release.json`) to **ClioPlay v2.2.7** covering the camera system overhaul (matching upcoming-camera map markers, flush 43 px frosted-glass camera card with capsule progress bar and synced red overspeed rim, speed-scaled detection and average-speed fixes, and two-tier `Overspeed audio`).

## 25 November 2026 — ClioPlay 2.2.6.3 announcement

- Update the release announcement notice (`release.json`) to **ClioPlay v2.2.6.3** covering the FAT32/exFAT SD-card install/update fixes, Windows WSL `venv` + `ensurepip` preflight, opt-in parallel atlas builder (`CLIOPLAY_PIPELINE=1`) and cached C++ build helpers.

## 24 November 2026 — ClioPlay 2.2.6.2 announcement

- Show release announcements for four-part versions such as `2.2.6.2` and compare all components when remembering dismissals.
- Update the release announcement notice (`release.json`) to **ClioPlay v2.2.6.2** covering U-turn spur elimination, simpler routes with fewer turns, and the parked off-road close-up map fix.
- Refresh the cached release announcement script in installed web apps.

## 21 November 2026 — Saved places, native UTF-8 names and ClioPlay 2.2.3

- Update the release announcement notice (`release.json`) to **ClioPlay v2.2.3** with links to the release and update guide.
- Preserve native UTF-8 international destination names directly over AVRCP (NFC normalised, control/zero-width characters stripped, up to 40 code points / 160 UTF-8 bytes).
- Add on-device **Saved places** and **Recent sends** (`places-store.js`, stored in `localStorage`) with one-tap reload, Save/Saved toggle, Stop badges, Clear recents, and automatic hiding when browser storage is unavailable.
- Bump the service worker cache (`clioplay-send-20261121-1`) to include `places-store.js` and refreshed assets.

## 20 November 2026 — Short map links and ClioPlay 2.2.1

- Announce ClioPlay 2.2.1 with links to the published release and update guide.
- Decode OpenStreetMap short links locally.
- Offer a direct **Open map link** action and support optional hosted redirect expansion for Apple Maps and Google Maps.

## 19 November 2026 — ClioPlay release announcements

- Add a compact, expandable release notice and version-specific dismissal.
- Include a feature summary, official release and software-update guide links.
- Remember dismissal locally and allow reopening from the footer.
- Load release metadata independently and cache it for offline PWA use.
- Keep the destination parser, Bluetooth send protocol and transfer controls unchanged.

## 19 October 2026 — Google Maps business links

- Preserve apostrophes in full URLs, including Kareem's Grill in Newcastle.
- Accept links surrounded by quotes, angle brackets, prose or Markdown;
  prefer Markdown's destination URL and retain parentheses within business names.
- Handle fully URL-encoded links, HTML ampersands and encoded Google coordinate tokens.
- Preserve encoded literal plus signs in place-path names.
- Prefer the business pin over camera positions in `@`, `ll` and `center` fields.
- Accept repeated copies of the same pin; clearly reject genuinely different locations.
- Reject address numbers and out-of-range pins rather than creating a wrong destination.
- Refresh the PWA cache and version module requests to avoid stale parser assets.

Validated with the supplied Kareem's Grill URL and Olive & Bean's actual expanded
Google Maps link from its own website. Automated tests also cover the official
Wylam Brewery link, which contains a place identifier but no coordinates: it
correctly asks for an expanded place URL. Short links still need to be opened
in a browser first; this static app does not geocode place IDs or addresses.
