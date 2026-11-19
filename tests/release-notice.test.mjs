import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { compareVersions, validRelease, initReleaseNotice } from "../release-notice.js";

const data = JSON.parse(await readFile(new URL("../release.json", import.meta.url), "utf8"));
const KEY = "clioplay-send-dismissed-release";
const ids = ["releaseNotice", "releaseToggle", "releaseDismiss", "releaseDetails", "releaseReopen",
  "releaseHeading", "releaseToggleHint", "releaseTitle", "releaseFeatures", "releaseLink", "releaseGuide", "sendHeading"];
function element() {
  const handlers = {};
  return { hidden: true, textContent: "", attributes: {}, children: [], focused: false,
    setAttribute(k, v) { this.attributes[k] = v; },
    addEventListener(k, fn) { handlers[k] = fn; },
    click() { handlers.click(); },
    focus() { this.focused = true; },
    replaceChildren(...children) { this.children = children; } };
}
function fixture({ version = data.version, stored = null, response, storage } = {}) {
  const nodes = Object.fromEntries(ids.map(id => [id, element()]));
  const doc = { getElementById: id => nodes[id], createElement: element };
  const values = new Map(stored ? [[KEY, stored]] : []);
  storage ??= { getItem: k => values.get(k), setItem: (k, v) => values.set(k, v) };
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push([url, options]);
    if (response instanceof Error) throw response;
    return response ?? { ok: true, json: async () => ({ ...data, version }) };
  };
  return { nodes, values, calls, start: () => initReleaseNotice({ doc, storage, fetcher }) };
}

test("manifest validates; numeric comparison and unsafe link rejection", () => {
  assert.ok(validRelease(data));
  assert.equal(compareVersions("2.10.0", "2.9.9"), 1);
  assert.equal(compareVersions("2.2.0", "2.2.0"), 0);
  assert.equal(compareVersions("2.2.0", "bad"), 1);
  assert.ok(!validRelease({ ...data, releaseUrl: "javascript:alert(1)" }));
  assert.ok(!validRelease({ ...data, updateUrl: "https://github.com/elsewhere/repo/blob/main/readme" }));
  assert.ok(!validRelease({ ...data, features: [null] }));
});

test("collapsed by default, expands, collapses, dismisses, and reopens", async () => {
  const f = fixture();
  assert.equal(await f.start(), true);
  const n = f.nodes;
  assert.equal(n.releaseNotice.hidden, false);
  assert.equal(n.releaseDetails.hidden, true);
  assert.equal(n.releaseToggle.attributes["aria-expanded"], "false");
  assert.deepEqual(f.calls, [["./release.json", { cache: "no-store" }]]);
  assert.deepEqual(n.releaseFeatures.children.map(c => c.textContent), data.features);
  assert.equal(n.releaseLink.href, data.releaseUrl);
  n.releaseToggle.click();
  assert.equal(n.releaseDetails.hidden, false);
  assert.equal(n.releaseToggle.attributes["aria-expanded"], "true");
  n.releaseToggle.click();
  assert.equal(n.releaseDetails.hidden, true);
  n.releaseDismiss.click();
  assert.equal(n.releaseNotice.hidden, true);
  assert.equal(f.values.get(KEY), data.version);
  assert.equal(n.sendHeading.focused, true);
  n.releaseReopen.click();
  assert.equal(n.releaseNotice.hidden, false);
  assert.equal(n.releaseDetails.hidden, false);
  assert.equal(n.releaseToggle.focused, true);
  assert.equal(f.values.get(KEY), data.version);
});

test("dismissal persists for same or older cached version; newer appears", async () => {
  for (const [version, hidden] of [["2.2.0", true], ["2.1.9", true], ["2.2.1", false]]) {
    const f = fixture({ version, stored: "2.2.0" });
    await f.start();
    assert.equal(f.nodes.releaseNotice.hidden, hidden);
    assert.equal(f.nodes.releaseReopen.hidden, false);
  }
});

test("network, HTTP, malformed and invalid metadata failures are harmless", async () => {
  for (const response of [new Error("offline"), { ok: false }, { ok: true, json: async () => { throw Error("invalid JSON"); } }, { ok: true, json: async () => ({}) }]) {
    const f = fixture({ response });
    assert.equal(await f.start(), false);
    assert.equal(f.nodes.releaseNotice.hidden, true);
    assert.equal(f.nodes.releaseReopen.hidden, true);
  }
});

test("unavailable local storage still allows session dismissal", async () => {
  const f = fixture({ storage: { getItem() { throw Error("blocked"); }, setItem() { throw Error("blocked"); } } });
  assert.equal(await f.start(), true);
  f.nodes.releaseDismiss.click();
  assert.equal(f.nodes.releaseNotice.hidden, true);
});
