import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createApp } from "../apps/server/src/app.ts";
import type { Config } from "../apps/server/src/config.ts";
import { createStore } from "../apps/server/src/db.ts";

test("RHODIZ Experience projects canonical identity and MemoryOS without local duplicates", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "openmuse-rhodiz-experience-"));
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
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith("/auth/login"))
      return Response.json({
        token: "canonical-bearer",
        user_id: "owner-rhodiz",
        usuario: "richard",
        rol: "admin",
      });
    if (url.endsWith("/api/rhodiz/sesion"))
      return Response.json({
        user_id: "owner-rhodiz",
        usuario: "richard",
        rol: "admin",
        perfil: { rhodiz_tone: "thoughtful" },
      });
    if (url.endsWith("/api/rhodiz/tareas")) return Response.json({ tareas: [] });
    if (url.endsWith("/api/rhodiz/proactividad/avisos?limite=50"))
      return Response.json({ avisos: [] });
    if (url.includes("/api/memoria/buscar?q="))
      return Response.json({
        recuerdos: [
          {
            id: "memory-1",
            contenido: "Prefiero reuniones por la mañana",
            tipo: "manual",
            creado_en: 1_700_000_000,
            version: 3,
          },
        ],
        vault: [],
      });
    if (url.endsWith("/api/memoria/recuerdos") && init?.method === "POST")
      return Response.json({ id: "memory-new", ok: true });
    if (url.includes("/api/memoria/recuerdos/memory-1?") && init?.method === "DELETE")
      return Response.json({ ok: true, id: "memory-1", version: 4 });
    throw new Error(`Unexpected fetch: ${url}`);
  });

  const { app, agent } = await createApp(db, config);
  t.after(() => agent.stop());

  const login = await app.request("/api/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ usuario: "richard", password: "test-password" }),
  });
  assert.equal(login.status, 200);
  assert.equal((await login.json()).token, "canonical-bearer");

  const headers = {
    Authorization: "Bearer canonical-bearer",
    "Content-Type": "application/json",
  };
  const workspaceResponse = await app.request("/api/agent", { headers });
  assert.equal(workspaceResponse.status, 200);
  const workspace = await workspaceResponse.json();
  assert.deepEqual(workspace.identity, {
    name: "RHODIZ IA",
    tone: "thoughtful",
    avatar: "sky",
    showChatUpdates: true,
  });
  assert.deepEqual(workspace.authority, {
    identity: "rhodiz",
    memory: "rhodiz",
    work: "rhodiz",
    notifications: "rhodiz",
    identityMutable: false,
    memoryEditable: false,
    workMutable: false,
    goalsIdeasMutable: false,
  });
  assert.equal(workspace.memories.length, 1);
  assert.equal(workspace.memories[0].id, "memory-1");
  assert.equal(workspace.memories[0].version, 3);
  assert.match(workspace.memories[0].source, /MemoryOS/);

  assert.equal(await db.get("owner-rhodiz", "agent-settings", "identity"), null);
  assert.deepEqual(await db.list("owner-rhodiz", "memories"), []);

  const create = await app.request("/api/agent/memories", {
    method: "POST",
    headers,
    body: JSON.stringify({ text: "Recordar esto" }),
  });
  assert.equal(create.status, 201);
  assert.deepEqual(await db.list("owner-rhodiz", "memories"), []);
  const createCall = calls.find(
    (call) => call.url.endsWith("/api/memoria/recuerdos") && call.init?.method === "POST",
  );
  assert.ok(createCall);
  assert.equal(
    new Headers(createCall.init?.headers).get("authorization"),
    "Bearer canonical-bearer",
  );
  assert.equal(new Headers(createCall.init?.headers).get("x-rhodiz-token"), "canonical-bearer");
  assert.deepEqual(JSON.parse(String(createCall.init?.body)), {
    tipo: "manual",
    contenido: "Recordar esto",
    etiquetas: ["manual", "openmuse"],
    fuerza: 1,
  });

  const forget = await app.request("/api/agent/memories/memory-1/forget", {
    method: "POST",
    headers,
    body: JSON.stringify({ version: 3 }),
  });
  assert.equal(forget.status, 200);
  const forgetCall = calls.find(
    (call) =>
      call.url.includes("/api/memoria/recuerdos/memory-1?") && call.init?.method === "DELETE",
  );
  assert.ok(forgetCall);
  assert.match(forgetCall.url, /version_esperada=3/);

  const identity = await app.request("/api/agent/identity", {
    method: "POST",
    headers,
    body: JSON.stringify({ name: "Other agent", tone: "warm" }),
  });
  assert.equal(identity.status, 409);
  assert.equal(await db.get("owner-rhodiz", "agent-settings", "identity"), null);
});
