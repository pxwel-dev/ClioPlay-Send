import test from "node:test";
import assert from "node:assert/strict";
import { parseDestination } from "../parser.js";
import { expandMapLink } from "../short-links.js";
import { resolver } from "../resolver/worker.mjs";

const google = "https://maps.app.goo.gl/eKkSYrmuKdvKDG1Q9";
const apple = "https://maps.apple/p/CqGzkcLw5IuWgg";
const harbour = "https://www.google.com/maps/place/Harbour+Bar/@-32.925181,151.7692132,17z/data=!8m2!3d-32.9251855!4d151.7717881!16s";
const warsaw = "https://www.google.pl/maps/place/Warszawa+Centralna/@52.2288,21.0033,17z/data=!3d52.228812!4d21.003291";
const limantour = "https://maps.apple.com/place?coordinate=19.418155,-99.159396&name=Limantour";
const limantourApex = "https://maps.apple/place?coordinate=19.418155,-99.159396&name=Limantour";
const wazeLive = "https://www.waze.com/live-map/directions/gb/england/london/big-ben?to=ll.51.5007%2C-0.1246";
const origin = "https://pxwel-dev.github.io";
const endpoint = "https://resolver.example";
const request = (body, requestOrigin = origin) =>
  new Request(endpoint, { method: "POST", headers: { Origin: requestOrigin }, body });

test("OSM short links decode locally and distinguish a pin from a view", () => {
  const view = parseDestination("https://osm.org/go/0EEQjE--");
  assert.equal(view.confidence, "map-center");
  assert.ok(Math.abs(view.lat - 51.5110) < 0.01 && Math.abs(view.lon - 0.0550) < 0.01);
  const pin = parseDestination("https://www.openstreetmap.org/go/0EEQjEEb?m");
  assert.equal(pin.confidence, "exact");
  assert.ok(Math.abs(pin.lat - 51.5110) < 0.01 && Math.abs(pin.lon - 0.0550) < 0.01);
  assert.equal(parseDestination("https://osm.org/go/Invalid.Code").ok, false);
});

test("Waze geohash share links decode locally offline", () => {
  const waze = parseDestination("https://waze.com/ul/hgcpvj0duq");
  assert.equal(waze.ok, true);
  assert.equal(waze.provider, "Waze");
  assert.equal(waze.confidence, "exact");
  assert.ok(Math.abs(waze.lat - 51.5074) < 0.0005 && Math.abs(waze.lon - -0.1278) < 0.0005);
  const bare = parseDestination("waze.com/ul/hgcpvj0duq");
  assert.equal(bare.ok, true);
  assert.equal(bare.provider, "Waze");
});

test("a shared title and the original short URL are available to the preview", () => {
  const result = parseDestination(`Harbour Bar\n${google}`);
  assert.equal(result.ok, false);
  assert.equal(result.shortLink, google);
  assert.equal(result.sharedName, "Harbour Bar");
  assert.equal(parseDestination("https://maps.app.goo.gl.evil.example/token").shortLink, undefined);
  // http:// short links upgrade cleanly to https://
  const upgraded = parseDestination("http://maps.app.goo.gl/eKkSYrmuKdvKDG1Q9");
  assert.equal(upgraded.shortLink, google);
});

test("Apple, Google (including share.google, g.page, cid/ftid, ccTLDs) and Waze redirects resolve", async () => {
  const cases = [
    [google, google, harbour, "Harbour Bar", -32.9251855, 151.7717881],
    [apple, apple, limantour, "Limantour", 19.418155, -99.159396],
    [apple, apple, limantourApex, "Limantour", 19.418155, -99.159396],
    ["https://goo.gl/maps/example", "https://goo.gl/maps/example", harbour, "Harbour Bar", -32.9251855, 151.7717881],
    ["https://share.google/abc123XYZ", "https://share.google/abc123XYZ", warsaw, "Warszawa Centralna", 52.228812, 21.003291],
    ["https://g.page/the-clove-club?share&utm_source=ig", "https://g.page/the-clove-club?share", harbour, "Harbour Bar", -32.9251855, 151.7717881],
    ["https://g.page/r/Cabc123XYZ/review", "https://g.page/r/Cabc123XYZ/review", warsaw, "Warszawa Centralna", 52.228812, 21.003291],
    ["https://maps.google.com/?cid=102817283910283&hl=en", "https://maps.google.com/?cid=102817283910283", harbour, "Harbour Bar", -32.9251855, 151.7717881],
    ["https://waze.com/ul/AbCdEf12", "https://waze.com/ul/AbCdEf12", wazeLive, "Big Ben", 51.5007, -0.1246],
  ];
  for (const [link, expectedFetch, final, name, lat, lon] of cases) {
    const worker = resolver(async (url, opts) => {
      assert.equal(url, expectedFetch);
      assert.equal(opts.redirect, "manual");
      return Response.redirect(final, 302);
    });
    const suffix = link.includes("?") ? "&tracking=example#fragment" : "?tracking=example#fragment";
    const response = await worker(request(link + suffix));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("access-control-allow-origin"), origin);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const result = parseDestination((await response.json()).url);
    assert.deepEqual([result.ok, result.name, result.lat, result.lon, result.confidence],
      [true, name, lat, lon, "exact"]);
  }
});

test("resolver unwraps EU/UK consent.google and google/url bounces and rejects evil targets", async () => {
  const consentTarget = `https://consent.google.co.uk/m?continue=${encodeURIComponent(warsaw)}&gl=GB`;
  const workerConsent = resolver(async () => Response.redirect(consentTarget, 302));
  const res = await workerConsent(request(google));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).url, warsaw);

  const googleUrlBounce = `https://www.google.com/url?q=${encodeURIComponent(harbour)}`;
  const workerBounce = resolver(async () => Response.redirect(googleUrlBounce, 302));
  const resBounce = await workerBounce(request("https://share.google/abc123XYZ"));
  assert.equal(resBounce.status, 200);
  assert.equal((await resBounce.json()).url, harbour);

  // Evil continue target must never be returned or followed
  const calls = [];
  const workerEvil = resolver(async url => {
    calls.push(url);
    return Response.redirect("https://consent.google.com/m?continue=https%3A%2F%2Fevil.example%2Fphish", 302);
  });
  assert.equal((await workerEvil(request(google))).status, 422);
  assert.deepEqual(calls, [google]);
});

test("resolver follows intermediate ftid redirect for coordinates and falls back cleanly on 200", async () => {
  const ftidUrl = "https://www.google.com/maps?q=Harbour+Bar&ftid=0x6b7314:0x1234";
  const calls = [];
  const worker2Hop = resolver(async url => {
    calls.push(url);
    if (url === google) return Response.redirect(ftidUrl, 302);
    return Response.redirect(harbour, 302);
  });
  const ok = await worker2Hop(request(google));
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).url, harbour);
  assert.deepEqual(calls, [google, ftidUrl]);

  const workerFallback = resolver(async url => {
    if (url === google) return Response.redirect(ftidUrl, 302);
    return new Response("<html></html>", { status: 200 });
  });
  const fb = await workerFallback(request(google));
  assert.equal(fb.status, 200);
  assert.equal((await fb.json()).url, ftidUrl);
});

test("Firebase dynamic maps.app.goo.gl/?link= unwraps locally offline and in worker", async () => {
  const fdl = `https://maps.app.goo.gl/?link=${encodeURIComponent(harbour)}&apn=com.google.android.apps.maps`;
  const parsed = parseDestination(fdl);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.name, "Harbour Bar");
  assert.equal(parsed.lat, -32.9251855);

  let fetched = false;
  const worker = resolver(async () => { fetched = true; return Response.redirect(harbour, 302); });
  const res = await worker(request(fdl));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).url, harbour);
  assert.equal(fetched, false);
});

test("resolver handles CORS preflight OPTIONS and multi-origin allowlist", async () => {
  const worker = resolver(async () => Response.redirect(harbour, 302));
  const preflight = await worker(new Request(endpoint, { method: "OPTIONS", headers: { Origin: origin } }));
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), origin);
  assert.match(preflight.headers.get("access-control-allow-methods") || "", /POST/);

  const badPreflight = await worker(new Request(endpoint, { method: "OPTIONS", headers: { Origin: "https://evil.example" } }));
  assert.equal(badPreflight.status, 403);

  const env = { SEND_ORIGIN: "https://pxwel-dev.github.io, https://send.clioplay.example" };
  const multi = await worker(request(google, "https://send.clioplay.example"), env);
  assert.equal(multi.status, 200);
  assert.equal(multi.headers.get("access-control-allow-origin"), "https://send.clioplay.example");
});

test("resolver refuses other origins, other destinations and oversized requests", async () => {
  const calls = [];
  const worker = resolver(async url => {
    calls.push(url);
    return Response.redirect("https://not-a-map.example/", 302);
  });
  assert.equal((await worker(request(apple, "https://example.org"))).status, 403);
  assert.equal((await worker(request("https://not-a-map.example"))).status, 400);
  assert.equal((await worker(request(apple + "A".repeat(3000)))).status, 400);
  assert.equal((await worker(request(apple))).status, 422);
  // share.google pointing to a non-Maps site must never be followed
  assert.equal((await worker(request("https://share.google/news1234"))).status, 422);
  assert.deepEqual(calls, [apple, "https://share.google/news1234"]);
});

test("resolver follows same-provider hops and stops redirect loops", async () => {
  const intermediate = "https://maps.app.goo.gl/example";
  const calls = [];
  const worker = resolver(async url => {
    calls.push(url);
    return Response.redirect(url === google ? intermediate : google, 302);
  });
  assert.equal((await worker(request(google))).status, 422);
  assert.deepEqual(calls, [google, intermediate]);
});

test("client verifies provider on returned URL and surfaces offline failures", async t => {
  const fetch = t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url, endpoint);
    assert.equal(options.body, apple);
    assert.equal(options.credentials, "omit");
    return Response.json({ url: limantour });
  });
  assert.equal(await expandMapLink(apple, endpoint), limantour);
  fetch.mock.mockImplementation(async () => Response.json({ url: harbour }));
  await assert.rejects(expandMapLink(apple, endpoint), /Unexpected map link/);
  fetch.mock.mockImplementation(async () => { throw Error("Offline"); });
  await assert.rejects(expandMapLink(apple, endpoint), /Offline/);
});
