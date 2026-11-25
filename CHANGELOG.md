# Sender changes

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
