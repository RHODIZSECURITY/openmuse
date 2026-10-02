import assert from "node:assert/strict";
import test from "node:test";
import type { Config } from "../apps/server/src/config.ts";
import {
  rhodizBrowserAction,
  rhodizBrowserClose,
  rhodizBrowserCreate,
  rhodizBrowserNavigate,
  rhodizBrowserPreview,
  rhodizBrowserSessions,
  rhodizBrowserState,
} from "../apps/server/src/rhodiz-browser.ts";

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

test("RHODIZ browser sessions are owner-authenticated and mapped read-only", async (t) => {
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(String(input), "http://rhodiz.internal/api/rhodiz/computer/sesiones");
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("x-rhodiz-token"), "canonical-bearer");
    assert.equal(headers.get("authorization"), null);
    return Response.json({
      sessions: [
        {
          id: "session_1",
          title: "Example",
          url: "https://example.com/",
          status: "active",
          created: 1700000000,
          touched: 1700000010,
        },
      ],
    });
  });

  assert.deepEqual(await rhodizBrowserSessions(config, "Bearer canonical-bearer"), [
    {
      id: "session_1",
      title: "Example",
      url: "https://example.com/",
      status: "active",
      updatedAt: new Date(1700000010000).toISOString(),
      previewUrl: "/api/rhodiz-browser/session_1/preview",
    },
  ]);
});

test("RHODIZ browser preview validates PNG receipt and exact byte length", async (t) => {
  const raw = Buffer.from("png-fixture");
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(
      String(input),
      "http://rhodiz.internal/api/rhodiz/computer/sesiones/session_1/captura",
    );
    assert.equal(new Headers(init?.headers).get("x-rhodiz-token"), "canonical-bearer");
    return Response.json({
      mime: "image/png",
      base64: raw.toString("base64"),
      bytes: raw.length,
    });
  });

  assert.deepEqual(
    Buffer.from(await rhodizBrowserPreview(config, "Bearer canonical-bearer", "session_1")),
    raw,
  );
});

test("RHODIZ browser preview fails closed on malformed receipt", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({ mime: "image/png", base64: "AAAA", bytes: 999 }),
  );
  await assert.rejects(
    rhodizBrowserPreview(config, "Bearer canonical-bearer", "session_1"),
    /length did not match/,
  );
});

test("RHODIZ browser sessions reject malformed canonical payloads", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({
      sessions: [
        {
          id: "bad id!",
          title: "bad",
          url: "https://example.com",
          status: "active",
          created: 1,
          touched: 1,
        },
      ],
    }),
  );
  await assert.rejects(
    rhodizBrowserSessions(config, "Bearer canonical-bearer"),
    /invalid session list/,
  );
});

test("RHODIZ browser create stays canonical and resolves the owned session", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    calls += 1;
    const url = String(input);
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("x-rhodiz-token"), "canonical-bearer");
    assert.equal(headers.get("authorization"), null);
    if (calls === 1) {
      assert.equal(url, "http://rhodiz.internal/api/rhodiz/computer/sesiones");
      assert.equal(init?.method, "POST");
      assert.deepEqual(JSON.parse(String(init?.body)), { locale: "es-ES" });
      return Response.json({ id: "session_2", created: 1700000020 });
    }
    assert.equal(url, "http://rhodiz.internal/api/rhodiz/computer/sesiones");
    return Response.json({
      sessions: [
        {
          id: "session_2",
          title: "New session",
          url: "about:blank",
          status: "active",
          created: 1700000020,
          touched: 1700000021,
        },
      ],
    });
  });

  const created = await rhodizBrowserCreate(config, "Bearer canonical-bearer", {
    locale: "es-ES",
  });
  assert.equal(created.id, "session_2");
  assert.equal(created.title, "New session");
  assert.equal(created.previewUrl, "/api/rhodiz-browser/session_2/preview");
});

test("RHODIZ navigation relays one-shot confirmation ticket without claiming authority", async (t) => {
  const requests: Array<{ headers: Headers; body: unknown }> = [];
  t.mock.method(globalThis, "fetch", async (_input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    requests.push({ headers, body: JSON.parse(String(init?.body)) });
    if (requests.length === 1)
      return Response.json({
        confirmacion_requerida: true,
        ticket: "one-shot-ticket",
        accion: "navegar",
      });
    return Response.json({ url: "https://example.com/", title: "Example" });
  });

  const first = await rhodizBrowserNavigate(config, "Bearer canonical-bearer", "session_1", {
    url: "https://example.com/",
  });
  assert.deepEqual(first, {
    confirmacion_requerida: true,
    ticket: "one-shot-ticket",
    accion: "navegar",
  });
  assert.equal(requests[0].headers.get("x-rhodiz-ticket"), null);
  assert.equal(requests[0].headers.get("x-rhodiz-token"), "canonical-bearer");

  const second = await rhodizBrowserNavigate(config, "Bearer canonical-bearer", "session_1", {
    url: "https://example.com/",
    ticket: "one-shot-ticket",
  });
  assert.equal("confirmacion_requerida" in second, false);
  assert.equal(requests[1].headers.get("x-rhodiz-ticket"), "one-shot-ticket");
  assert.equal(requests[1].headers.get("x-rhodiz-token"), "canonical-bearer");
  assert.deepEqual(requests[1].body, { url: "https://example.com/" });
});

test("RHODIZ sensitive browser actions preserve ticket semantics", async (t) => {
  const tickets: Array<string | null> = [];
  t.mock.method(globalThis, "fetch", async (_input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    tickets.push(headers.get("x-rhodiz-ticket"));
    if (tickets.length === 1)
      return Response.json({
        confirmacion_requerida: true,
        ticket: "click-ticket",
        accion: "click",
      });
    return Response.json({ ok: true, url: "https://example.com/", title: "Example" });
  });

  const first = await rhodizBrowserAction(config, "Bearer canonical-bearer", "session_1", {
    action: "click",
    selector: "#submit",
  });
  assert.equal("confirmacion_requerida" in first, true);
  const second = await rhodizBrowserAction(config, "Bearer canonical-bearer", "session_1", {
    action: "click",
    selector: "#submit",
    ticket: "click-ticket",
  });
  assert.equal("confirmacion_requerida" in second, false);
  assert.deepEqual(tickets, [null, "click-ticket"]);
});

test("RHODIZ browser close never falls back to the OpenMuse worker", async (t) => {
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(String(input), "http://rhodiz.internal/api/rhodiz/computer/sesiones/session_1");
    assert.equal(init?.method, "DELETE");
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("x-rhodiz-token"), "canonical-bearer");
    assert.equal(headers.get("authorization"), null);
    return Response.json({ closed: true });
  });

  assert.deepEqual(await rhodizBrowserClose(config, "Bearer canonical-bearer", "session_1"), {
    closed: true,
  });
});
