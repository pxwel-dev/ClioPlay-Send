import test from "node:test";
import assert from "node:assert/strict";
import { parseDestination } from "../parser.js";
import { expandMapLink } from "../short-links.js";
import { resolver } from "../resolver/worker.mjs";

const google = "https://maps.app.goo.gl/eKkSYrmuKdvKDG1Q9";
const apple = "https://maps.apple/p/CqGzkcLw5IuWgg";
const harbour = "https://www.google.com/maps/place/Harbour+Bar/@-32.925181,151.7692132,17z/data=!8m2!3d-32.9251855!4d151.7717881!16s";
const limantour = "https://maps.apple.com/place?coordinate=19.418155,-99.159396&name=Limantour";
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

test("a shared title and the original short URL are available to the preview", () => {
  const result = parseDestination(`Harbour Bar\n${google}`);
  assert.equal(result.ok, false);
  assert.equal(result.shortLink, google);
  assert.equal(result.sharedName, "Harbour Bar");
  assert.equal(parseDestination("https://maps.app.goo.gl.evil.example/token").shortLink, undefined);
});

test("Apple and Google redirects resolve to destination pins", async () => {
  for (const [link, final, name, lat, lon] of [
    [google, harbour, "Harbour Bar", -32.9251855, 151.7717881],
    [apple, limantour, "Limantour", 19.418155, -99.159396],
    ["https://goo.gl/maps/example", harbour, "Harbour Bar", -32.9251855, 151.7717881],
  ]) {
    const worker = resolver(async (url, opts) => {
      assert.equal(url, link);
      assert.equal(opts.redirect, "manual");
      return Response.redirect(final, 302);
    });
    const response = await worker(request(link + "?tracking=example#fragment"));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("access-control-allow-origin"), origin);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const result = parseDestination((await response.json()).url);
    assert.deepEqual([result.ok, result.name, result.lat, result.lon, result.confidence],
      [true, name, lat, lon, "exact"]);
  }
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
  assert.deepEqual(calls, [apple]);
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
