import assert from "node:assert/strict";
import test from "node:test";
import type { Config } from "../apps/server/src/config.ts";
import { AppError } from "../apps/server/src/errors.ts";
import { rhodizPcState } from "../apps/server/src/rhodiz-pc.ts";

const config: Config = {
  mode: "sample",
  port: 8787,
  host: "127.0.0.1",
  publicUrl: "http://localhost:8787",
  dataDir: "/tmp/openmuse-rhodiz-pc-state-test",
  agentBackend: "agui",
  authBackend: "rhodiz",
  rhodizApiUrl: "http://rhodiz.internal",
  agentUrl: "http://rhodiz.internal/api/rhodiz/openmuse/agui",
  googleRedirectUri: "http://localhost:8787/api/google/callback",
  allowedOrigins: [],
};

test("RHODIZ PC state forwards only the canonical bearer and treats stopped workbench as connected", async (t) => {
  t.mock.method(globalThis, "fetch", async (_input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("x-rhodiz-token"), "canonical-bearer");
    assert.equal(headers.get("authorization"), null);
    return Response.json({
      enabled: true,
      provider: "rhodiz",
      protocolVersion: 1,
      openmuseBridgeReady: true,
      status: "stopped",
      workspacePath: "/workspace",
      network: "disabled",
    });
  });
  assert.equal(await rhodizPcState(config, "Bearer canonical-bearer"), "connected");
});

test("RHODIZ PC state distinguishes disabled forbidden and offline without inventing readiness", async (t) => {
  const responses = [
    new Response(null, { status: 404 }),
    new Response(null, { status: 403 }),
    Response.json({
      enabled: false,
      provider: "rhodiz",
      status: "unconfigured",
      workspacePath: "/workspace",
      network: "disabled",
    }),
    Response.json({
      enabled: true,
      provider: "rhodiz",
      protocolVersion: 1,
      openmuseBridgeReady: false,
      status: "stopped",
      workspacePath: "/workspace",
      network: "disabled",
    }),
    Response.json({ enabled: true, provider: "wrong", status: "running" }),
  ];
  t.mock.method(globalThis, "fetch", async () => {
    const response = responses.shift();
    if (!response) throw new Error("unexpected extra RHODIZ PC probe");
    return response;
  });
  assert.equal(await rhodizPcState(config, "Bearer token"), "disabled");
  assert.equal(await rhodizPcState(config, "Bearer token"), "forbidden");
  assert.equal(
    await rhodizPcState(config, "Bearer token"),
    "offline",
    "enabled=false is not a valid connected bridge response",
  );
  assert.equal(
    await rhodizPcState(config, "Bearer token"),
    "offline",
    "status alone cannot enable OpenMuse before the full bridge handshake is ready",
  );
  assert.equal(await rhodizPcState(config, "Bearer token"), "offline");
});

test("RHODIZ PC transport failures degrade to offline", async (t) => {
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("connection refused");
  });
  assert.equal(await rhodizPcState(config, "Bearer token"), "offline");
});

test("RHODIZ PC canonical auth failure stays a 401", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response(null, { status: 401 }));
  await assert.rejects(
    rhodizPcState(config, "Bearer token"),
    (error: unknown) => error instanceof AppError && error.status === 401,
  );
});
