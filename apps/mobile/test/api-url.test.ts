import assert from "node:assert/strict";
import test from "node:test";
import { normalizeWebBasePath, resolveApiUrl } from "../src/api-url.ts";

test("API defaults and explicit URLs remain unchanged for development and native clients", () => {
  assert.equal(resolveApiUrl({ platform: "web" }), "http://localhost:8787");
  assert.equal(resolveApiUrl({ platform: "ios", webBasePath: "/muse" }), "http://localhost:8787");
  assert.equal(
    resolveApiUrl({ platform: "android", webBasePath: "/muse" }),
    "http://10.0.2.2:8787",
  );
  assert.equal(
    resolveApiUrl({ platform: "web", configuredUrl: "https://api.example.invalid/" }),
    "https://api.example.invalid",
  );
});

test("an explicit web base uses the browser origin for REST and streaming", () => {
  for (const [configured, expected] of [
    ["/muse", "/muse"],
    ["/muse/", "/muse"],
    ["", ""],
    ["/", ""],
    ["/tenant/muse", "/tenant/muse"],
  ]) {
    const api = resolveApiUrl({
      platform: "web",
      webBasePath: configured,
      webOrigin: "https://rhodiz.example.invalid",
    });
    assert.equal(api, `https://rhodiz.example.invalid${expected}`);
    assert.equal(new URL(`${api}/api/health`).pathname, `${expected}/api/health`);
    assert.equal(new URL(`${api}/api/copilotkit`).pathname, `${expected}/api/copilotkit`);
  }
});

test("deployment base paths cannot supply an origin, query or path traversal", () => {
  for (const value of [
    "muse",
    "//other.invalid",
    "https://other.invalid",
    "/muse?x=1",
    "/muse#x",
    "/../muse",
    "/muse//x",
    "/muse%2Fx",
    "/muse\\x",
  ])
    assert.throws(() => normalizeWebBasePath(value));
  assert.throws(() => resolveApiUrl({ platform: "web", webBasePath: "/muse" }));
  assert.throws(() =>
    resolveApiUrl({ platform: "web", webBasePath: "/muse", webOrigin: "file:///tmp/index.html" }),
  );
});
