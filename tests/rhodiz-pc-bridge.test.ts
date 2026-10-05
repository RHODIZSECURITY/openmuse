import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createApp } from "../apps/server/src/app.ts";
import type { Config } from "../apps/server/src/config.ts";
import { createStore } from "../apps/server/src/db.ts";

test("RHODIZ PC keeps OpenMuse local computer effects fail-closed until the governed bridge exists", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "openmuse-rhodiz-pc-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const db = await createStore();
  t.after(() => db.close());

  const config: Config = {
    mode: "sample",
    port: 8787,
    host: "127.0.0.1",
    publicUrl: "http://localhost:8787",
    dataDir: directory,
    agentBackend: "agui",
    authBackend: "rhodiz",
    rhodizApiUrl: "http://rhodiz.internal",
    agentUrl: "http://rhodiz.internal/api/rhodiz/openmuse/agui",
    googleRedirectUri: "http://localhost:8787/api/google/callback",
    allowedOrigins: [],
  };

  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/api/rhodiz/sesion"))
      return Response.json({
        user_id: "owner-rhodiz",
        usuario: "richard",
        rol: "admin",
      });
    throw new Error(`Unexpected fetch: ${url}`);
  });

  const { app, agent } = await createApp(db, config);
  t.after(() => agent.stop());

  for (const path of [
    "/api/computer",
    "/api/computer/start",
    "/api/computer/files?path=/workspace",
  ]) {
    const response = await app.request(path, {
      method: path.endsWith("/start") ? "POST" : "GET",
      headers: { Authorization: "Bearer canonical-bearer" },
    });
    assert.equal(response.status, 409);
    const body = await response.json();
    assert.match(
      body.error?.message ?? body.message ?? JSON.stringify(body),
      /disabled in RHODIZ mode/,
    );
  }
});

test("RHODIZ workspace advertises a RHODIZ PC backend without enabling the workspace early", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "openmuse-rhodiz-pc-runtime-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const db = await createStore();
  t.after(() => db.close());

  const config: Config = {
    mode: "sample",
    port: 8787,
    host: "127.0.0.1",
    publicUrl: "http://localhost:8787",
    dataDir: directory,
    agentBackend: "agui",
    authBackend: "rhodiz",
    rhodizApiUrl: "http://rhodiz.internal",
    agentUrl: "http://rhodiz.internal/api/rhodiz/openmuse/agui",
    googleRedirectUri: "http://localhost:8787/api/google/callback",
    allowedOrigins: [],
  };

  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/api/rhodiz/sesion"))
      return Response.json({ user_id: "owner-rhodiz", usuario: "richard", rol: "admin" });
    if (url.endsWith("/api/rhodiz/computer/estado"))
      return Response.json({ detail: "not mounted" }, { status: 404 });
    if (url.endsWith("/api/rhodiz/pc"))
      return Response.json({ detail: "not mounted" }, { status: 404 });
    throw new Error(`Unexpected fetch: ${url}`);
  });

  const { app, agent } = await createApp(db, config);
  t.after(() => agent.stop());

  const response = await app.request("/api/workspace", {
    headers: { Authorization: "Bearer canonical-bearer" },
  });
  assert.equal(response.status, 200);
  const workspace = await response.json();
  assert.equal(workspace.runtime.computerBackend, "rhodiz");
  assert.equal(workspace.runtime.computerStatus, "disabled");
  assert.equal(workspace.runtime.browserBackend, "rhodiz");
  assert.equal(workspace.runtime.browserStatus, "disabled");
});
