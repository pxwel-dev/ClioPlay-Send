# ClioPlay Link changes

## 28 November 2026 — ClioPlay Link v3.0.0 Ecosystem Redesign

- **Rebrand & Exact Carminat Glass UI (`index.html`, `styles.css`, `manifest.webmanifest`, `app.js`):**
  - Rebranded from ClioPlay Send to **ClioPlay Link** (`https://pxwel-dev.github.io/ClioPlay-Link/`) with relative asset/PWA paths so both GitHub Pages hosting and local testing work identically.
  - Exact ClioPlay `clio040.c` RGB565 Day & Night palettes, frosted-glass surfaces (`hud_glass.h` 1 px specular top rim), `System / Dark / Light` theme selector, and model-neutral 3-tab bottom bar (**Navigate · Places · Car**).
- **Bidirectional `CLP3` Bluetooth Transport (`protocol.js`, `transport.js`):**
  - Instant AVRCP `nexttrack` (`ACK`) / `previoustrack` (`NACK`) delivery confirmation (~0.3 s/packet) with automatic fallback to ClioPlay v2.2 timed windows.
  - Supports atomic multi-stop trips (`CLP3:T`), 2-way favourites sync (`CLP3:F`), full 18-field `prefs.ini` 12-byte car settings (`CLP3:P`), remote Cancel Route / Skip Stop / Clock & TZ sync (`CLP3:C`), live Link Ping (`CLP3:H`), and optical QR sync stepping (`CLP3:Q`).
- **Zero-Menu Optical QR Sync (`qr-sync.js`, `qr-scanner.js`, `qr-decode.js`):**
  - Tap **Sync from Car** to open ClioPlay's floating frosted-glass map QR pill (`CLP3:Q:S`) and stream favourites, active trip, recents, car settings, map coverage bbox, and `mobility.h` / `mobility_ml.h` Driving Insights via closed-loop BT-ACK frames (`CS1:...`).
  - Bundled zero-dependency offline pure-JS ISO/IEC 18004 QR decoder (`qr-decode.js`) as automatic fallback on iOS Safari alongside native `BarcodeDetector` on Android Chrome.
  - Deep-link `#q=C1...` Connect QR handling from ClioPlay's `Pair new phone` and connected phone cards.
- **Interactive Mini-Map, Live GPS Itinerary Rail & Driving Insights (`mini-map.js`, `trip-rail.js`, `insights.js`):**
  - Zero-dependency 60 fps Canvas Mini-Map with pinch/pan, drag-to-nudge pin, ClioPlay route/car colours, pre-drive out-of-map check, and offline vector grid fallback.
  - Unified Omnibox combining free OSM Photon/Nominatim place search (gated by Online Features toggle), local Saved/Recent/Parked matches, and full offline map-link/coordinate parsing.
  - Live foreground-only phone GPS vertical progress rail mirroring ClioPlay's `P_TRIP` view, plus offline 2-opt multi-stop order optimiser and Trip Presets.
  - Rich `mobility.h` + `mobility_ml.h` Driving Insights visualiser (odometer grid, 7-day & 24h rhythm charts, learned road-class & cold-weather pace, intelligence badges, tappable top places / slowdown hotspots / recent drives).
  - Pending-Sync delta tracking (`Phone only` dots, sticky `Apply N changes to Car` bar), 1-tap Restore Full Profile to Car, and 1-file JSON Backup & Restore.
- **Full 18-Language & RTL Parity (`i18n.js`, `locales/*.json`):**
  - Exact same 18 languages as ClioPlay (`en, fr, es, de, it, pt, nl, pl, tr, el, uk, ru, ar, zh-Hans, ja, ko, hi, he`) with full CSS logical RTL (`dir="rtl"`) for Arabic and Hebrew, OS auto-detection, and automated completeness tests.
- Updated `release.json` to **v3.0.0** and bumped `sw.js` precache (`clioplay-link-3.0.0`) with all new modules and 18 locale files.

## 27 November 2026 — ClioPlay 2.2.8 announcement

- Update the release announcement notice (`release.json`) to **ClioPlay v2.2.8** covering the `Z0–Z9` cartographic road rendering overhaul (continuous wide carriageways, 3D perspective tapering, Day/Night kerb casings, priority outward parallel-road expansion, smooth S-curve wide-to-minor road transitions), world-anchored road label stability with competition hysteresis, `Q4` close-zoom junction tracking/stop-settling, and early ignition-off shutdown reliability.
- Bump service worker precache (`clioplay-send-20261127-1`) so installed web apps refresh the announcement cache cleanly.

## 26 November 2026 — Multi-stop trip builder, My Location / Where I Parked & iPhone Share Sheet

- **Multi-stop Trip Builder (`trip-store.js`, `app.js`, `index.html`, `styles.css`):**
  - Queue up to 10 stops (matching ClioPlay's `TRIP_MAX_TARGETS`) from the destination card (`+ Add to multi-stop trip`), from any Saved/Recent/Parked place (`+`), or via `&trip=1` share URLs, with `↑`/`↓` reordering and on-device persistence.
  - Transmit the entire itinerary in a single continuous Bluetooth audio session (final destination as `CLP2:N`, then stops in forward order as `CLP2:S` to match `clio040.c`'s `trip_add_stop()` insertion order) with live step highlights, progress bar, countdown, and cancel support.
- **My Location & Where I Parked (`navigator.geolocation`):**
  - Added a **Locate** pill in the **Send** header to grab your current GPS fix (±m accuracy) directly into the composer.
  - Added a **Where I Parked** card in **Places** (with 1-tap **Park here**, saved timestamp/accuracy, **Load**, **+ Trip**, and **Clear**) plus a pinned **Parked car** quick chip on **Send**.
- **iPhone Share Sheet integration (`parser.js`, `app.js`, `index.html`):**
  - Extended URL query handling (`parseShareParams`) to support `?text=`, `?url=`, `?q=`, direct `?lat=&lon=` (`lng=` alias) + `?name=`, `&action=stop|new`, and `&trip=1` / `&add=trip`.
  - Added an **iPhone Share Sheet (Apple Shortcut)** 4-step setup card with a 1-tap **Copy URL** button in **Settings**.
- Added `./trip-store.js` to [sw.js](sw.js) precache, bumped asset versions & cache (`clioplay-send-20261126-5`), and added `tests/trip-and-share.test.mjs`.

## 26 November 2026 — Complete offline CoMaps support

- Added full **CoMaps** support (`parser.js`, `index.html`, `README.md`), decoding 100% offline with zero network calls:
  - Short share links (`https://comaps.at/<code>/<Name>`, scheme-less `comaps.at/…`, plus `cm://` and `ge0://` deep links, and Organic Maps `omaps.app/…`) using the exact `ge0` 30-bit Base64 coordinate codec.
  - Multi-line CoMaps app shares (`Check out\n<Name>\n...`) with automatic skipping of the `"Check out"` boilerplate line when a link has no URL name slug.
  - CoMaps `/map?v=1&ll=…&n=…` pin links (with multi-location ambiguity protection) and `/route?sll=…&dll=…&daddr=…` destination links.
  - CoMaps web-page copied coordinate lines (`DMS: 54° 58' 16.03" N, 1° 37' 3.46" W` and `Decimal: 54.971118, -1.617628`).
- Bumped module asset query versions (`?v=20261126-4`) and service worker cache (`clioplay-send-20261126-4`).

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
  - Modernised the PWA & home-screen app icons (`icons/icon-512.png`, `icons/icon-192.png`, `icons/apple-touch-icon.png`, `icons/icon.svg`) and top-bar emblem to match ClioPlay's official blue-gradient (`#4AB1FF → #0060EB`) navigation arrow with full-bleed iOS/Android maskable framing and wireless send arcs.
  - Bumped PWA asset query versions (`?v=20261126-2`) and service worker cache (`clioplay-send-20261126-2`).

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
