<h1 align="center">ClioPlay Send</h1>
<p align="center">A static phone web app that sends a destination to CLIOPLAY through Bluetooth
media metadata.</p>
<p align="center">
  Created and maintained by <a href="https://github.com/pxwel-dev">Pawel (pxwel-dev)</a>.
</p>


## Use

1. Connect your phone to CLIOPLAY Bluetooth and open this app.
2. In the **Send** tab, paste Google Maps, Apple Maps, CoMaps, Waze or
   OpenStreetMap destination links, or tap **Coords** to enter latitude and
   longitude (decimal or DMS). Check the detected destination card.
3. Choose **Route as new** or **Add as stop**, then tap **Send to ClioPlay**.

CoMaps (`comaps.at/…`, `cm://`, `ge0://`, `/map`, `/route`, plus Organic Maps
`omaps.app/…`), OpenStreetMap (`osm.org/go/…`), Waze geohash (`waze.com/ul/h…`),
Firebase dynamic Google links (`maps.app.goo.gl/?link=…`), and wrapped consent
links decode locally, including offline. For shortened Google Maps (`maps.app.goo.gl`,
`goo.gl/maps`, `share.google`, `g.page`, `?cid=` / `?ftid=`), Apple Maps
(`maps.apple/p/…`), and non-geohash Waze (`waze.com/ul/…`) links, ClioPlay Send
expands them automatically when a resolver is configured (this can be switched
to manual confirmation in **Settings → Auto-expand short links**). Expansion
strips tracking parameters and sends only the allowlisted short URL to the
resolver to read its redirect; you can also choose **Open map link** and paste
the expanded address-bar URL or coordinates. Always check the preview before
sending, especially if a link shows **Map centre**.

The Bluetooth media window defaults to **4 seconds** and can be adjusted to
1, 2, 3, 4, 5 or 8 seconds in the **Settings** tab (remembered when browser
storage is available). With ClioPlay v2.2.3's AVRCP notifications, shorter send
windows (1–2 seconds) usually transfer immediately while 4 seconds remains the
safe default for all phones. Destination names preserve native UTF-8 scripts
(up to 40 characters / 160 UTF-8 bytes) without ASCII transliteration. Music
pauses during transmission and may need to be resumed. The phone's success
message reports completion of the send window; the protocol has no head-unit
acknowledgement. Check the destination on the head unit.

### Saved places and recent sends

When browser storage is available, ClioPlay Send keeps an on-device list of
**Saved** places and **Recent** sends in the **Places** tab (plus one-tap
**Quick places** chips on the **Send** screen — no server or account is used).
Tap **Save** on any detected destination (or the bookmark icon on a recent send)
to store it, or tap any entry to load its name, coordinates and action directly
into **Send**.

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

## Hosting the short-link resolver

GitHub Pages serves static files. Map providers’ redirects need to be read by a
separately hosted service because browsers do not expose those headers to the app.
The Cloudflare Worker in `resolver/` handles only allowlisted Google Maps
(`maps.app.goo.gl`, `goo.gl/maps`, `share.google`, `g.page`, `?cid=` / `?ftid=`),
Apple Maps (`maps.apple/p/…`), and Waze (`waze.com/ul/…`) short-link formats.
It strips tracking parameters, handles regional Google ccTLDs, unwraps EU/UK
`consent.google.*` and `google.*/url` bounces, follows multi-hop same-provider
redirects safely (never touching third-party hosts), and returns the expanded
URL so ClioPlay Send parses coordinates locally. No geocoding keys are required.

Deploy the Worker from this folder with `npx wrangler deploy --config resolver/wrangler.toml`.
Set `SEND_ORIGIN` in the Worker configuration to your Send site's origin (or a
comma-separated list of allowed origins). Put the deployed HTTPS URL in the
`map-link-resolver` meta tag in `index.html` before publishing the Pages site.
Keep Worker request logging disabled as specified in the configuration. Map
providers still receive the link needed to perform the lookup.

## ClioPlay release announcements

The collapsed announcement below the header can be expanded or dismissed without
interrupting the sender. Dismissal applies to the announced version (and any
older cached version) on that browser; a newer release appears automatically.
The footer link reopens the announcement without clearing the saved dismissal.
The notice does not detect the version installed in a car, and no destination,
vehicle or driving-history data is sent to a server by this feature.

Prepare `release.json` with the numeric `version`, a short `title`, one to eight
user-facing `features` of up to 240 characters each, and the GitHub release and
update-guide URLs. Versions can have three or four components, such as `2.2.6`
or `2.2.6.2`. Publish the downloadable ClioPlay release first, then verify the
URLs and deploy the announcement through Pages. No JavaScript, CSS or service
worker cache-version change is needed for a metadata-only release. Do not
announce an unreleased build. The app fetches the metadata independently on
opening, uses the cached copy when offline, and hides the notice if no valid
metadata is available. Storage-disabled browsers can dismiss for the session.

Run the announcement regression tests with Node.js 22 or later:

```sh
node --test tests/*.test.mjs
```

## Google Maps business links — 19 October 2026

Apostrophes in names such as **Kareem's Grill** no longer truncate URLs.
Quoted, Markdown-wrapped and fully encoded URLs are accepted. Business pin
coordinates take priority over camera positions, and repeated copies of the
same coordinate pair are allowed. Truly different locations in one link are
reported as ambiguous. Links with only place identifiers or addresses still
need expanding in Google Maps; no geocoding service is used.

See `CHANGELOG.md` for further information.

## Authorship

ClioPlay Send was created and is maintained by [Pawel (pxwel-dev)](https://github.com/pxwel-dev) as a companion application to [ClioPlay](https://github.com/pxwel-dev/ClioPlay).
