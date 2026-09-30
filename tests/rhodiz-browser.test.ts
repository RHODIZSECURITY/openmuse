import assert from "node:assert/strict";
import test from "node:test";
import type { Config } from "../apps/server/src/config.ts";
import { rhodizBrowserState } from "../apps/server/src/rhodiz-browser.ts";

const config: Config = {
  mode: "sample",
  port: 8787,
  host: "127.0.0.1",
  publicUrl: "http://localhost:8787",
  dataDir: "/tmp/openmuse-rhodiz-browser-test",
  agentBackend: "agui",
  authBackend: "rhodiz",
  rhodizApiUrl: "http://rhodiz.internal",
  agentUrl: "http://rhodiz.internal/api/rhodiz/openmuse/agui",
  googleRedirectUri: "http://localhost:8787/api/google/callback",
  allowedOrigins: [],
};

test("RHODIZ browser status forwards only the canonical session token", async (t) => {
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(String(input), "http://rhodiz.internal/api/rhodiz/computer/estado");
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("x-rhodiz-token"), "canonical-bearer");
    assert.equal(headers.get("authorization"), null);
    return Response.json({ configurado: true, disponible: true, base_url: "must-not-leak" });
  });

  assert.equal(await rhodizBrowserState(config, "Bearer canonical-bearer"), "connected");
});

test("RHODIZ browser status distinguishes offline, disabled and forbidden", async (t) => {
  const responses = [
    Response.json({ configurado: true, disponible: false }),
    Response.json({ detail: "not mounted" }, { status: 404 }),
    Response.json({ detail: "admin required" }, { status: 403 }),
  ];
  t.mock.method(globalThis, "fetch", async () => {
    const response = responses.shift();
    assert.ok(response);
    return response;
  });

  assert.equal(await rhodizBrowserState(config, "Bearer canonical-bearer"), "offline");
  assert.equal(await rhodizBrowserState(config, "Bearer canonical-bearer"), "disabled");
  assert.equal(await rhodizBrowserState(config, "Bearer canonical-bearer"), "forbidden");
});

test("RHODIZ browser transport failure degrades to offline", async (t) => {
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("sidecar route unavailable");
  });
  assert.equal(await rhodizBrowserState(config, "Bearer canonical-bearer"), "offline");
});
