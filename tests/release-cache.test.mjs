import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../sw.js", import.meta.url), "utf8");
const scope = "https://example.test/ClioPlay-Link/";
const cached = new Map();
const handlers = {};
let network;
let precached = [];
const cache = {
  async addAll(requests) { precached = requests.map(r => r.url); },
  async put(key, value) { cached.set(key.url, value); },
  async match(key) { return cached.get(key.url)?.clone(); },
};
vm.runInNewContext(source, {
  URL, Request, Response,
  location: new URL(scope),
  self: { registration: { scope }, addEventListener: (k, fn) => { handlers[k] = fn; }, skipWaiting() {} },
  caches: { open: async () => cache },
  fetch: request => network(request),
});

async function request(path) {
  let result;
  const writes = [];
  handlers.fetch({ request: new Request(new URL(path, scope)), respondWith: value => { result = value; }, waitUntil: value => writes.push(value) });
  if (!result) return undefined;
  const response = await result;
  await Promise.all(writes);
  return response;
}

test("precache includes release metadata and script at the Pages subpath", async () => {
  let completion;
  handlers.install({ waitUntil: value => { completion = value; } });
  await completion;
  assert.ok(precached.includes(scope + "release.json"));
  assert.ok(precached.includes(scope + "release-notice.js"));
  assert.ok(precached.includes(scope + "app.js"));
  assert.ok(precached.includes(scope + "places-store.js"));
  assert.ok(precached.includes(scope + "trip-store.js"));
  assert.ok(precached.includes(scope + "short-links.js"));
  assert.ok(precached.includes(scope + "icons/icon.svg"));
});

test("fresh metadata wins, then network and HTTP failures fall back to cached metadata", async () => {
  network = async () => new Response('{"version":"2.2.0"}');
  assert.equal((await (await request("release.json")).json()).version, "2.2.0");
  network = async () => { throw Error("offline"); };
  assert.equal((await (await request("release.json")).json()).version, "2.2.0");
  network = async () => new Response("not found", { status: 404 });
  assert.equal((await (await request("release.json")).json()).version, "2.2.0");
  network = async () => new Response('{"version":"2.2.1"}');
  assert.equal((await (await request("release.json")).json()).version, "2.2.1");
  network = async () => { throw Error("offline"); };
  assert.equal((await (await request("release.json")).json()).version, "2.2.1");
  assert.equal(await request("https://github.com/pxwel-dev/ClioPlay/releases"), undefined);
});
