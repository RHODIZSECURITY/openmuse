import assert from "node:assert/strict";
import test from "node:test";
import { aguiHeaders } from "../apps/server/src/agent.ts";
import { createApp } from "../apps/server/src/app.ts";
import { Auth } from "../apps/server/src/auth.ts";
import type { Config } from "../apps/server/src/config.ts";
import { createStore, type Store } from "../apps/server/src/db.ts";

const base: Config = {
  mode: "sample",
  port: 8787,
  host: "127.0.0.1",
  publicUrl: "http://localhost:8787",
  dataDir: "/tmp/openmuse-rhodiz-auth-test",
  agentBackend: "agui",
  authBackend: "rhodiz",
  rhodizApiUrl: "http://rhodiz.internal",
  agentUrl: "http://rhodiz.internal/api/rhodiz/openmuse/agui",
  googleRedirectUri: "http://localhost:8787/api/google/callback",
  allowedOrigins: [],
};

const unusedStore = new Proxy(
  {},
  {
    get() {
      throw new Error("RHODIZ auth must not create an OpenMuse session record");
    },
  },
) as Store;

test("RHODIZ login returns the canonical bearer and owner without a second session", async (t) => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return Response.json({
      token: "rhodiz-session-token",
      user_id: "9c3d22bc-1f50-4a67-b413-a589593abf77",
      usuario: "richard",
      rol: "admin",
    });
  });

  const auth = new Auth(unusedStore, base, "unused-signing-key");
  const session = await auth.session({
    usuario: "richard",
    password: "test-password",
    dispositivo: "OpenMuse RHODIZ shell",
  });

  assert.equal(session.token, "rhodiz-session-token");
  assert.equal(session.owner, "9c3d22bc-1f50-4a67-b413-a589593abf77");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "http://rhodiz.internal/auth/login");
  const body = JSON.parse(String(calls[0].init?.body));
  assert.deepEqual(body, {
    usuario: "richard",
    password: "test-password",
    dispositivo: "OpenMuse RHODIZ shell",
  });
});

test("RHODIZ bearer is revalidated against the canonical session endpoint", async (t) => {
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(String(input), "http://rhodiz.internal/api/rhodiz/sesion");
    assert.equal(new Headers(init?.headers).get("x-rhodiz-token"), "canonical-bearer");
    return Response.json({
      user_id: "9c3d22bc-1f50-4a67-b413-a589593abf77",
      usuario: "richard",
      rol: "admin",
    });
  });

  const auth = new Auth(unusedStore, base, "unused-signing-key");
  assert.equal(await auth.owner("Bearer canonical-bearer"), "9c3d22bc-1f50-4a67-b413-a589593abf77");
});

test("RHODIZ auth fails closed when canonical validation rejects the bearer", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({ detail: "sesión inválida" }, { status: 401 }),
  );
  const auth = new Auth(unusedStore, base, "unused-signing-key");
  await assert.rejects(auth.owner("Bearer expired"), { status: 401 });
});

test("AG-UI forwards the verified RHODIZ bearer and ignores a static agent token", () => {
  const rhodiz = { ...base, agentToken: "must-not-win" };
  assert.deepEqual(aguiHeaders(rhodiz, "Bearer canonical-bearer"), {
    Authorization: "Bearer canonical-bearer",
  });
  assert.deepEqual(aguiHeaders(rhodiz), {});

  const local = { ...base, authBackend: "local" as const, agentToken: "service-token" };
  assert.deepEqual(aguiHeaders(local, "Bearer client-session"), {
    Authorization: "Bearer service-token",
  });
});

test("RHODIZ conversation history stays canonical and local conversation writes are disabled", async (t) => {
  const db = await createStore();
  try {
    const calls: string[] = [];
    t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(url);
      if (url === "http://rhodiz.internal/api/rhodiz/sesion") {
        assert.equal(new Headers(init?.headers).get("x-rhodiz-token"), "canonical-bearer");
        return Response.json({
          user_id: "9c3d22bc-1f50-4a67-b413-a589593abf77",
          usuario: "richard",
          rol: "admin",
        });
      }
      if (url === "http://rhodiz.internal/api/rhodiz/openmuse/conversation?threadId=local-main") {
        assert.equal(new Headers(init?.headers).get("authorization"), "Bearer canonical-bearer");
        return Response.json({
          threadId: "local-main",
          canonical: "rhodiz",
          messages: [
            { id: "m-user", role: "user", content: "Hola RHODIZ" },
            { id: "m-assistant", role: "assistant", content: "Hola Richard" },
          ],
        });
      }
      if (url === "http://rhodiz.internal/api/rhodiz/computer/estado") {
        const requestHeaders = new Headers(init?.headers);
        assert.equal(requestHeaders.get("x-rhodiz-token"), "canonical-bearer");
        assert.equal(requestHeaders.get("authorization"), null);
        return Response.json({ configurado: true, disponible: true });
      }
      if (url === "http://rhodiz.internal/api/rhodiz/computer/sesiones") {
        const requestHeaders = new Headers(init?.headers);
        assert.equal(requestHeaders.get("x-rhodiz-token"), "canonical-bearer");
        assert.equal(requestHeaders.get("authorization"), null);
        return Response.json({ sessions: [] });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const server = await createApp(db, {
      ...base,
      intelligenceApiKey: "configured-but-must-not-own-history",
      workerUrl: "http://openmuse-worker.invalid",
      workerToken: "must-never-be-used-in-rhodiz-mode",
      computerEnabled: true,
    });
    const headers = {
      Authorization: "Bearer canonical-bearer",
      "Content-Type": "application/json",
    };

    const history = await server.app.request("/api/conversation", { headers });
    assert.equal(history.status, 200);
    assert.deepEqual(await history.json(), {
      messages: [
        { id: "m-user", role: "user", content: "Hola RHODIZ" },
        { id: "m-assistant", role: "assistant", content: "Hola Richard" },
      ],
      canonical: "rhodiz",
    });

    const save = await server.app.request("/api/conversation", {
      method: "PUT",
      headers,
      body: JSON.stringify({
        messages: [{ id: "local-copy", role: "user", content: "must not persist" }],
      }),
    });
    assert.equal(save.status, 200);
    assert.deepEqual(await save.json(), {
      ok: true,
      canonical: "rhodiz",
      localWrite: false,
    });
    assert.equal(
      await db.get("9c3d22bc-1f50-4a67-b413-a589593abf77", "conversations", "default"),
      null,
    );

    const workspace = await server.app.request("/api/workspace", { headers });
    assert.equal(workspace.status, 200);
    const snapshot = await workspace.json();
    assert.equal(snapshot.runtime.richThreads, false);
    assert.equal(snapshot.runtime.conversationStore, "rhodiz");
    assert.equal(snapshot.runtime.browserBackend, "rhodiz");
    assert.equal(snapshot.runtime.browserStatus, "connected");
    assert.deepEqual(snapshot.browsers, []);
    const browserConnection = snapshot.connections.find(
      (connection: { id: string }) => connection.id === "browser",
    );
    assert.equal(browserConnection?.status, "connected");
    assert.ok(browserConnection?.capabilities.includes("RHODIZ Policy / Action Fabric"));

    const localBrowser = await server.app.request("/api/browsers", {
      method: "POST",
      headers,
      body: JSON.stringify({ url: "https://example.com" }),
    });
    assert.equal(localBrowser.status, 409);

    const localComputer = await server.app.request("/api/computer/status", { headers });
    assert.equal(localComputer.status, 409);

    const main = await server.app.request("/api/main-thread", { headers });
    assert.equal(main.status, 200);
    assert.deepEqual(await main.json(), {
      threadId: "local-main",
      existing: true,
      canonical: "rhodiz",
    });

    assert.ok(
      calls.includes("http://rhodiz.internal/api/rhodiz/openmuse/conversation?threadId=local-main"),
    );
    assert.ok(calls.includes("http://rhodiz.internal/api/rhodiz/computer/estado"));
    assert.ok(!calls.some((url) => url.startsWith("http://openmuse-worker.invalid")));
  } finally {
    await db.close();
  }
});

test("RHODIZ history proxy rejects a response without the canonical marker", async (t) => {
  const db = await createStore();
  try {
    t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "http://rhodiz.internal/api/rhodiz/sesion")
        return Response.json({
          user_id: "owner-1",
          usuario: "richard",
          rol: "admin",
        });
      if (url === "http://rhodiz.internal/api/rhodiz/openmuse/conversation?threadId=local-main")
        return Response.json({
          threadId: "local-main",
          canonical: "foreign",
          messages: [{ id: "m1", role: "assistant", content: "untrusted history" }],
        });
      throw new Error(`unexpected fetch: ${url}`);
    });

    const server = await createApp(db, base);
    const response = await server.app.request("/api/conversation", {
      headers: { Authorization: "Bearer canonical-bearer" },
    });
    assert.equal(response.status, 422);
  } finally {
    await db.close();
  }
});
