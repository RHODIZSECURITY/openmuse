import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { Hono } from "hono";
import { createApp } from "../apps/server/src/app.ts";
import {
  assertApiDeploymentConfig,
  readConfig,
  shouldStartLocalTaskWorker,
} from "../apps/server/src/config.ts";
import { createStore } from "../apps/server/src/db.ts";
import { createWebMiddleware } from "../apps/server/src/web.ts";

const syntheticKey = Buffer.alloc(32, 17).toString("base64");
const environment: NodeJS.ProcessEnv = {
  WORKSPACE_MODE: "live",
  AUTH_BACKEND: "rhodiz",
  AGENT_BACKEND: "agui",
  OPENMUSE_DEPLOYMENT: "rhodiz",
  OPENMUSE_WEB_DIR: "/unused-export-fixture",
  RHODIZ_API_URL: "http://rhodiz.example.invalid",
  AGENT_URL: "http://rhodiz.example.invalid/api/rhodiz/openmuse/agui",
  PUBLIC_API_URL: "https://workspace.example.invalid/muse",
  TOKEN_ENCRYPTION_KEY: syntheticKey,
  TASK_WORKER_ENABLED: "false",
  COMPUTER_ENABLED: "false",
  ALLOWED_ORIGINS: "https://workspace.example.invalid",
};
async function directory(t: TestContext) {
  const path = await mkdtemp(join(tmpdir(), "openmuse-rhodiz-packaging-"));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}

test("RHODIZ packaging is explicit, sovereign and local-worker-free", () => {
  const config = readConfig(environment);
  assert.doesNotThrow(() => assertApiDeploymentConfig(config));
  assert.equal(shouldStartLocalTaskWorker(config), false);
  assert.equal(config.intelligenceApiKey, undefined);
  assert.equal(config.computerEnabled, false);
  assert.equal(readConfig({}).mode, "sample");
});

test("RHODIZ packaging rejects alternate authorities and accidental sample/local modes", () => {
  for (const changes of [
    { WORKSPACE_MODE: "sample" },
    { AUTH_BACKEND: "local" },
    { AGENT_BACKEND: "model" },
    { TASK_WORKER_ENABLED: "true" },
    { COMPUTER_ENABLED: "true" },
    { BROWSER_WORKER_URL: "http://worker.example.invalid" },
    { WORKER_TOKEN: "synthetic" },
    { AGENT_TOKEN: "synthetic" },
    { CPK_INTELLIGENCE_API_KEY: "synthetic" },
    { OPENMUSE_WEB_DIR: "" },
    { OPENMUSE_DEPLOYMENT: "unknown" },
    { PUBLIC_API_URL: undefined },
    { TOKEN_ENCRYPTION_KEY: "invalid" },
    { AGENT_URL: "http://other.example.invalid/api/rhodiz/openmuse/agui" },
    { PUBLIC_API_URL: "https://workspace.example.invalid/muse?token=synthetic" },
    { RHODIZ_API_URL: "file:///tmp/not-a-server" },
  ])
    assert.throws(() => readConfig({ ...environment, ...changes }));
});

test("encryption keys can be injected from an owned runtime file without exposing their contents", async (t) => {
  const root = await directory(t);
  const file = join(root, "encryption-key");
  await writeFile(file, `${syntheticKey}\n`, { mode: 0o600 });
  const env = { ...environment, TOKEN_ENCRYPTION_KEY: undefined, TOKEN_ENCRYPTION_KEY_FILE: file };
  assert.equal(readConfig(env).encryptionKey, syntheticKey);
  assert.throws(() => readConfig({ ...environment, TOKEN_ENCRYPTION_KEY_FILE: file }), /not both/);
  for (const value of ["", "x".repeat(300)]) {
    await writeFile(file, value);
    assert.throws(
      () => readConfig(env),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.ok(!error.message.includes(syntheticKey));
        return true;
      },
    );
  }
  assert.throws(() => readConfig({ ...env, TOKEN_ENCRYPTION_KEY_FILE: join(root, "missing") }));
  assert.throws(() => readConfig({ ...env, TOKEN_ENCRYPTION_KEY_FILE: root }));
});

test("the packaged API serves the exported web while keeping canonical API failures separate", async (t) => {
  const root = await directory(t);
  const web = join(root, "web"),
    data = join(root, "data");
  await mkdir(join(web, "assets"), { recursive: true });
  await writeFile(join(web, "index.html"), "<!doctype html><title>Packaged OpenMuse</title>");
  await writeFile(join(web, "assets", "client.js"), "globalThis.packaged = true;");
  await writeFile(join(web, ".env"), "synthetic-not-public");
  await writeFile(join(web, "client.js.map"), "synthetic-not-public");
  await writeFile(join(web, "rhodiz-web.json"), JSON.stringify({ version: 1, basePath: "/muse" }));
  const config = readConfig({ ...environment, OPENMUSE_WEB_DIR: web, DATA_DIR: data });
  const db = await createStore();
  t.after(() => db.close());
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL) => {
    assert.equal(String(input), "http://rhodiz.example.invalid/api/rhodiz/sesion");
    return Response.json({ user_id: "synthetic-owner", usuario: "fixture", rol: "admin" });
  });
  const { app, agent } = await createApp(db, config);
  t.after(() => agent.stop());
  const index = await app.request("/");
  assert.equal(index.status, 200);
  assert.match(index.headers.get("content-type") ?? "", /text\/html/);
  assert.equal(index.headers.get("x-frame-options"), "DENY");
  assert.match(index.headers.get("content-security-policy") ?? "", /frame-ancestors 'none'/);
  assert.match(await index.text(), /Packaged OpenMuse/);
  const deniedOrigin = await app.request("/", {
    headers: { Origin: "https://untrusted.example.invalid" },
  });
  assert.equal(deniedOrigin.status, 403);
  assert.equal(deniedOrigin.headers.get("x-frame-options"), "DENY");
  assert.match(deniedOrigin.headers.get("content-security-policy") ?? "", /frame-ancestors 'none'/);
  assert.equal((await app.request("/", { method: "HEAD" })).status, 200);
  const asset = await app.request("/assets/client.js");
  assert.equal(asset.status, 200);
  assert.match(await asset.text(), /packaged/);
  const health = await app.request("/api/health");
  assert.equal(health.status, 200);
  assert.equal((await health.json()).authBackend, "rhodiz");
  assert.equal((await app.request("/api/missing")).status, 401);
  const unknown = await app.request("/api/missing", {
    headers: { Authorization: "Bearer synthetic" },
  });
  assert.equal(unknown.status, 404);
  assert.doesNotMatch(unknown.headers.get("content-type") ?? "", /text\/html/);
  for (const path of ["/assets/missing.js", "/.env", "/client.js.map"])
    assert.equal((await app.request(path)).status, 404);
});

test("RHODIZ compose exposes OpenMuse only on loopback for the canonical host gateway", async () => {
  const compose = await readFile(new URL("../infra/compose.rhodiz.yaml", import.meta.url), "utf8");
  assert.match(compose, /127\.0\.0\.1:28787:8787/);
  assert.doesNotMatch(compose, /0\.0\.0\.0:28787:8787/);
});

test("web startup rejects overlapping writable storage and mismatched artifact paths", async (t) => {
  const root = await directory(t);
  const web = join(root, "web"),
    data = join(root, "data");
  await mkdir(web);
  await mkdir(data);
  await writeFile(join(web, "index.html"), "<title>fixture</title>");
  await writeFile(join(web, "rhodiz-web.json"), JSON.stringify({ version: 1, basePath: "/wrong" }));
  await assert.rejects(createWebMiddleware(web, web), /separate directories/);
  await assert.rejects(createWebMiddleware(root, data), /separate directories/);
  await assert.rejects(createWebMiddleware(web, root), /separate directories/);
  await assert.rejects(
    createWebMiddleware(web, data, environment.PUBLIC_API_URL),
    /does not match/,
  );
  await assert.rejects(createWebMiddleware(join(root, "missing"), data));
  const app = new Hono();
  app.use("*", await createWebMiddleware(web, data));
  assert.equal((await app.request("/api/unknown")).status, 404);
  assert.equal((await app.request("/", { method: "POST" })).status, 404);
});
