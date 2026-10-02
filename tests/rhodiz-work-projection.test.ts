import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../apps/server/src/app.ts";
import { type Config, shouldStartLocalTaskWorker } from "../apps/server/src/config.ts";
import { createStore } from "../apps/server/src/db.ts";

const owner = "9c3d22bc-1f50-4a67-b413-a589593abf77";
const config: Config = {
  mode: "sample",
  port: 8787,
  host: "127.0.0.1",
  publicUrl: "http://localhost:8787",
  dataDir: "/tmp/openmuse-rhodiz-work-test",
  agentBackend: "agui",
  authBackend: "rhodiz",
  rhodizApiUrl: "http://rhodiz.internal",
  agentUrl: "http://rhodiz.internal/api/rhodiz/openmuse/agui",
  googleRedirectUri: "http://localhost:8787/api/google/callback",
  allowedOrigins: [],
};

const canonicalTask = {
  id: "task-1",
  prompt: "Prepare the canonical RHODIZ outcome",
  estado: "pausada",
  resultado: "",
  ticket_pendiente: "SECRET-CONFIRMATION-TICKET",
  accion_pendiente: "email.send",
  ultimo_error: "",
  usar_memoria: 1,
  permitir_herramientas: 1,
  pasos_totales: 3,
  pasos_completados: 1,
  creado_en: 1_700_000_000,
  actualizado_en: 1_700_000_010,
};

function session() {
  return Response.json({
    user_id: owner,
    usuario: "richard",
    rol: "admin",
    perfil: {},
  });
}

function headers() {
  return {
    Authorization: "Bearer canonical-bearer",
    "Content-Type": "application/json",
  };
}

test("RHODIZ workspace projects canonical tasks and notices and ignores local Work state", async (t) => {
  const db = await createStore();
  t.after(async () => db.close());

  await db.put(owner, "tasks", {
    id: "local-task-must-not-leak",
    title: "Local task",
    prompt: "local",
    kind: "agent",
    status: "running",
    plan: [],
    evidence: [],
    input: {},
    state: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    attempts: 0,
    artifactIds: [],
  });
  await db.put(owner, "goals", {
    id: "local-goal-must-not-leak",
    title: "Local goal",
    description: "local",
    category: "Local",
    status: "active",
    milestones: [],
    createdAt: new Date().toISOString(),
  });
  await db.put(owner, "ideas", {
    id: "local-idea-must-not-leak",
    title: "Local idea",
    reason: "local",
    evidence: [],
    prompt: "local",
    kind: "agent",
    input: {},
    status: "new",
    createdAt: new Date().toISOString(),
  });
  await db.put(owner, "notifications", {
    id: "local-notice-must-not-leak",
    title: "Local notice",
    body: "local",
    createdAt: new Date().toISOString(),
    read: false,
  });
  await db.put(owner, "actions", {
    id: "local-action-must-not-leak",
    owner,
    kind: "email.send",
    status: "awaiting_review",
    hash: "local-hash",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    input: {
      kind: "email.send",
      data: { to: ["nobody@example.com"], subject: "local", body: "local", attachmentIds: [] },
    },
  });
  await db.put(owner, "activity", {
    id: "local-activity-must-not-leak",
    date: new Date().toISOString(),
    title: "Local activity",
    detail: "local",
    kind: "action",
  });

  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === "http://rhodiz.internal/api/rhodiz/sesion") return session();
    if (url === "http://rhodiz.internal/api/memoria/buscar?q=")
      return Response.json({ recuerdos: [] });
    if (url === "http://rhodiz.internal/api/rhodiz/tareas")
      return Response.json({ tareas: [canonicalTask] });
    if (url === "http://rhodiz.internal/api/rhodiz/proactividad/avisos?limite=50")
      return Response.json({
        avisos: [
          {
            clave: "disk-warning",
            nivel: "alerta",
            titulo: "Storage needs attention",
            detalle: "Canonical RHODIZ notice",
            ts: "2026-09-30T18:00:00Z",
          },
        ],
      });
    throw new Error(`unexpected fetch: ${url}`);
  });

  const server = await createApp(db, config);
  const workspace = await server.workspace.snapshot(owner);
  assert.deepEqual(workspace.actions, []);
  assert.deepEqual(workspace.activity, []);

  const response = await server.app.request("/api/agent", { headers: headers() });
  assert.equal(response.status, 200);
  const body = await response.json();

  assert.equal(body.tasks.length, 1);
  assert.equal(body.tasks[0].id, "task-1");
  assert.equal(body.tasks[0].status, "waiting_approval");
  assert.equal(body.tasks[0].state.canonical, "rhodiz");
  assert.equal(body.tasks[0].state.approvalRequired, true);
  assert.equal(body.goals.length, 0);
  assert.equal(body.monitors.length, 0);
  assert.equal(body.ideas.length, 0);
  assert.equal(body.notifications.length, 1);
  assert.equal(body.notifications[0].title, "Storage needs attention");
  assert.equal(body.authority.work, "rhodiz");
  assert.equal(body.authority.notifications, "rhodiz");
  assert.equal(body.authority.workMutable, false);
  assert.equal(body.authority.goalsIdeasMutable, false);
  assert.equal(body.worker.running, false);

  const serialized = JSON.stringify(body);
  assert.doesNotMatch(serialized, /local-task-must-not-leak/);
  assert.doesNotMatch(serialized, /local-goal-must-not-leak/);
  assert.doesNotMatch(serialized, /local-idea-must-not-leak/);
  assert.doesNotMatch(serialized, /local-notice-must-not-leak/);
  assert.doesNotMatch(serialized, /local-action-must-not-leak/);
  assert.doesNotMatch(serialized, /local-activity-must-not-leak/);
  assert.doesNotMatch(serialized, /SECRET-CONFIRMATION-TICKET/);
  assert.doesNotMatch(serialized, /email\.send/);
});

test("RHODIZ task detail remains canonical and never exposes Action Fabric tickets", async (t) => {
  const db = await createStore();
  t.after(async () => db.close());
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === "http://rhodiz.internal/api/rhodiz/sesion") return session();
    if (url === "http://rhodiz.internal/api/rhodiz/tareas/task-1")
      return Response.json(canonicalTask);
    throw new Error(`unexpected fetch: ${url}`);
  });
  const server = await createApp(db, config);
  const response = await server.app.request("/api/agent/tasks/task-1", { headers: headers() });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.id, "task-1");
  assert.equal(body.status, "waiting_approval");
  assert.deepEqual(body.events, []);
  assert.deepEqual(body.artifacts, []);
  assert.doesNotMatch(JSON.stringify(body), /SECRET-CONFIRMATION-TICKET|email\.send/);
});

test("RHODIZ Work mutations fail closed while canonical cancel is relayed", async (t) => {
  const db = await createStore();
  t.after(async () => db.close());
  const calls: Array<{ url: string; method: string }> = [];
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, method });
    if (url === "http://rhodiz.internal/api/rhodiz/sesion") return session();
    if (url === "http://rhodiz.internal/api/rhodiz/tareas/task-1/cancelar") {
      assert.equal(method, "POST");
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer canonical-bearer");
      return Response.json({ ok: true, estado: "cancelada" });
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  const server = await createApp(db, config);

  for (const [path, payload] of [
    ["/api/agent/tasks", { prompt: "local task", kind: "agent", input: {} }],
    ["/api/agent/goals", { title: "local goal" }],
    [
      "/api/agent/monitors",
      {
        title: "local monitor",
        url: "https://example.com",
        condition: "change",
        value: "",
        intervalMinutes: 15,
      },
    ],
    ["/api/agent/ideas/refresh", {}],
    ["/api/agent/ideas/idea-1", { action: "dismiss" }],
    ["/api/agent/notifications/notice-1/read", {}],
    [
      "/api/actions",
      {
        kind: "email.send",
        data: {
          to: ["nobody@example.com"],
          subject: "must not create local approval",
          body: "local",
          attachmentIds: [],
        },
      },
    ],
    ["/api/actions/local-action/decide", { hash: "local-hash", decision: "approve" }],
  ] as const) {
    const response = await server.app.request(path, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(payload),
    });
    assert.equal(response.status, 409, path);
  }

  const resume = await server.app.request("/api/agent/tasks/task-1/control", {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ action: "resume" }),
  });
  assert.equal(resume.status, 409);

  const cancel = await server.app.request("/api/agent/tasks/task-1/control", {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ action: "cancel" }),
  });
  assert.equal(cancel.status, 200);
  assert.deepEqual(await cancel.json(), { ok: true, estado: "cancelada" });
  assert.equal(
    calls.filter((call) => call.url.endsWith("/api/rhodiz/tareas/task-1/cancelar")).length,
    1,
  );

  assert.equal(await db.get(owner, "tasks", "task-1"), null);
  assert.equal(await db.get(owner, "goals", "local-goal"), null);
  assert.equal(await db.get(owner, "ideas", "idea-1"), null);
});

test("RHODIZ mode never starts the local OpenMuse TaskWorker", () => {
  assert.equal(shouldStartLocalTaskWorker(config), false);
  assert.equal(
    shouldStartLocalTaskWorker({
      ...config,
      authBackend: "local",
      agentBackend: "sample",
      taskWorkerEnabled: true,
    }),
    true,
  );
  assert.equal(
    shouldStartLocalTaskWorker({
      ...config,
      authBackend: "local",
      agentBackend: "sample",
      taskWorkerEnabled: false,
    }),
    false,
  );
});
