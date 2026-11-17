# Sender changes

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
