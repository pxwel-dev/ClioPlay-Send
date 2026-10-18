# ClioPlay Send

A static phone web app that sends a destination to CLIOPLAY through Bluetooth
media metadata. No server, API key, account or Node build is required.

## Use

1. Connect your phone to CLIOPLAY Bluetooth and open this app.
2. Paste full Google Maps, Apple Maps, Waze or OpenStreetMap destination links,
   or enter latitude and longitude. Check the detected destination.
3. Choose **Route as new** or **Add as stop**, then **Send to ClioPlay**.

For short links, first open them in your browser and copy the expanded URL.
Links that identify only a map view or several possible coordinates need an
explicit destination. The app does not resolve short links over a server.

The Bluetooth media window defaults to **4 seconds**. Transfer options allow
1, 2, 3, 4, 5 or 8 seconds and remember your selection when browser storage is
available. Music pauses during transmission and may need to be resumed.
The phone's success message reports completion of the send window; the protocol
has no head-unit acknowledgement. Check the destination on the head unit.

## Host

Serve the contents of this folder over HTTPS, or localhost for development.
Do not open `index.html` through a `file:` URL. For a local preview:

```sh
python3 -m http.server 8000
```

Run that command from this folder, then open http://localhost:8000.
For GitHub Pages, publish this folder as the site's artifact, or copy its
contents to the root of a separate Pages repository and enable Pages there.
All asset paths are relative, so it also works under a repository subpath.
The service worker caches only this app's assets. After updating an installed
PWA, close and reopen it if the previous version remains visible.

Pair this sender with the bundled CLP2-capable head-unit executable. Browser
media-session support and the phone's Bluetooth metadata behaviour affect
transfer reliability; duration is adjustable for this reason.

## Google Maps business links — 19 October 2026

Apostrophes in names such as **Kareem's Grill** no longer truncate URLs.
Quoted, Markdown-wrapped and fully encoded URLs are accepted. Business pin
coordinates take priority over camera positions, and repeated copies of the
same coordinate pair are allowed. Truly different locations in one link are
reported as ambiguous. Links with only place identifiers or addresses still
need expanding in Google Maps; no geocoding service is used.

See `CHANGELOG.md` and `DEPLOY.txt` for the update and deployment instructions.
For the optional developer tests, use Node.js 18 or newer:

```sh
node --test tests/parser.test.mjs
```

The test fixtures contain actual Newcastle business URLs with provenance;
other encoding/wrapping cases are generated variants, not additional live lookups.
