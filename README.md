<h1 align="center">ClioPlay Send</h1>
<p align="center">A static phone web app that sends a destination to CLIOPLAY through Bluetooth
media metadata.</p>
<p align="center">
  Created and maintained by <a href="https://github.com/pxwel-dev">Pawel (pxwel-dev)</a>.
</p>


## Use

1. Connect your phone to CLIOPLAY Bluetooth and open this app.
2. Paste Google Maps, Apple Maps, Waze or OpenStreetMap destination links,
   or enter latitude and longitude. Check the detected destination.
3. Choose **Route as new** or **Add as stop**, then **Send to ClioPlay**.

OpenStreetMap short links work directly, including offline. For Apple Maps and
Google Maps short links, choose **Expand short link** when the site has a resolver
configured. That action sends the short URL to the resolver, which requests its
redirect from the map provider. You can also choose **Open map link** and paste the
expanded address-bar URL or the destination coordinates. Always check the preview
before sending, especially if a link contains only a map centre.

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

## Hosting the short-link resolver

GitHub Pages serves static files. Map providers’ redirects need to be read by a
separately hosted service because browsers do not expose those headers to the app.
The Cloudflare Worker in `resolver/` handles only the supported Apple Maps and
Google Maps short-link formats. It returns the expanded URL, and ClioPlay Send
reads its coordinates locally. No geocoding keys are required.

Deploy the Worker from this folder with `npx wrangler deploy --config resolver/wrangler.toml`.
Set `SEND_ORIGIN` in the Worker configuration to your Send site's origin. Put the
deployed HTTPS URL in the `map-link-resolver` meta tag in `index.html` before
publishing the Pages site. The meta tag is empty by default, so the site offers
**Open map link** until a resolver is configured. Keep Worker request logging
disabled as specified in the configuration. Map providers still receive the link
needed to perform the lookup.

## ClioPlay release announcements

The collapsed announcement below the header can be expanded or dismissed without
interrupting the sender. Dismissal applies to the announced version (and any
older cached version) on that browser; a newer release appears automatically.
The footer link reopens the announcement without clearing the saved dismissal.
The notice does not detect the version installed in a car, and no destination,
vehicle or driving-history data is sent to a server by this feature.

After publishing a new **downloadable** ClioPlay release, update `release.json`
in this repository: change the numeric `version`, short `title`, one to eight
user-facing `features`, and the exact published GitHub release and update-guide
URLs. Commit that file and let Pages deploy it. No JavaScript, CSS or service
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
