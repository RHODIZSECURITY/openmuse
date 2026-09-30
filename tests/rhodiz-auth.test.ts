import assert from "node:assert/strict";
import test from "node:test";
import { aguiHeaders } from "../apps/server/src/agent.ts";
import { Auth } from "../apps/server/src/auth.ts";
import type { Config } from "../apps/server/src/config.ts";
import type { Store } from "../apps/server/src/db.ts";

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
