import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createApp } from "../apps/server/src/app.ts";
import { Auth } from "../apps/server/src/auth.ts";
import type { Config } from "../apps/server/src/config.ts";
import { createStore, type Store } from "../apps/server/src/db.ts";
import { Files } from "../apps/server/src/files.ts";
import type { AgentTask } from "../packages/domain/src/agent.ts";
import type { Artifact } from "../packages/domain/src/index.ts";
import { createSamplePdf } from "../packages/integrations/src/pdf.ts";

function config(directory: string): Config {
  return {
    mode: "sample",
    port: 8787,
    host: "127.0.0.1",
    publicUrl: "http://localhost:8787",
    dataDir: directory,
    agentBackend: "sample",
    googleRedirectUri: "http://localhost:8787/api/google/callback",
    allowedOrigins: [],
  };
}

test("file operation recovers a published PDF after metadata persistence loss", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "openmuse-file-recovery-"));
  const db = await createStore();
  const cfg = config(directory);
  const server = await createApp(db, cfg);
  t.after(async () => {
    await server.agent.stop();
    await db.close();
    await rm(directory, { recursive: true, force: true });
  });

  const owner = "file-recovery";
  const bytes = await createSamplePdf();
  const insert = db.insertIfAbsent.bind(db);
  let publishedId = "";
  t.mock.method(db, "insertIfAbsent", async (...args: Parameters<Store["insertIfAbsent"]>) => {
    if (args[0] === owner && args[1] === "files" && !publishedId) {
      publishedId = args[2].id;
      throw new Error("metadata unavailable");
    }
    return insert(...args);
  });

  await assert.rejects(
    server.files.import(owner, "sample.pdf", bytes, "fixture", undefined, "import-once"),
    /metadata unavailable/,
  );
  assert.ok(publishedId);
  assert.equal((await server.files.list(owner)).length, 0);

  const restarted = new Files(db, cfg, new Auth(db, cfg, "sample-signing-key"));
  const recovered = await restarted.import(
    owner,
    "sample.pdf",
    bytes,
    "fixture",
    undefined,
    "import-once",
  );
  assert.equal(recovered.id, publishedId);
  assert.deepEqual(new Uint8Array(await restarted.bytes(owner, recovered.id)), bytes);
  assert.equal((await restarted.list(owner)).length, 1);
});

test("file operation identity isolates owner, input and independent requests", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "openmuse-file-identity-"));
  const db = await createStore();
  const server = await createApp(db, config(directory));
  t.after(async () => {
    await server.agent.stop();
    await db.close();
    await rm(directory, { recursive: true, force: true });
  });

  const owner = "file-identities";
  const bytes = await createSamplePdf();
  const source = await server.files.import(owner, "sample.pdf", bytes, "fixture");
  const fields = { participant_name: "Sample Student", permission_granted: true };
  const [first, concurrent] = await Promise.all([
    server.files.fill(owner, source.id, fields, "task-fill"),
    server.files.fill(owner, source.id, fields, "task-fill"),
  ]);
  assert.equal(first.id, concurrent.id);
  assert.equal(first.createdAt, concurrent.createdAt);
  assert.equal((await server.files.list(owner)).filter((file) => file.parentId).length, 1);

  const reordered = await server.files.fill(
    owner,
    source.id,
    { permission_granted: true, participant_name: "Sample Student" },
    "task-fill",
  );
  assert.equal(reordered.id, first.id);
  assert.notEqual(
    (await server.files.fill(owner, source.id, fields, "another-task")).id,
    first.id,
  );
  assert.notEqual(
    (
      await server.files.fill(
        owner,
        source.id,
        { participant_name: "Another Student" },
        "task-fill",
      )
    ).id,
    first.id,
  );

  const manual = await server.files.fill(owner, source.id, fields);
  assert.notEqual((await server.files.fill(owner, source.id, fields)).id, manual.id);
  const otherOwner = await server.files.import(
    "other-file-owner",
    "sample.pdf",
    bytes,
    "fixture",
    undefined,
    "owner-scoped",
  );
  assert.notEqual(
    (
      await server.files.import(
        owner,
        "sample.pdf",
        bytes,
        "fixture",
        undefined,
        "owner-scoped",
      )
    ).id,
    otherOwner.id,
  );
});

test("document retry reuses its filled PDF after task checkpoint loss", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "openmuse-document-replay-"));
  const db = await createStore();
  const server = await createApp(db, config(directory));
  t.after(async () => {
    await server.agent.stop();
    await db.close();
    await rm(directory, { recursive: true, force: true });
  });

  const owner = "interrupted-document";
  await server.workspace.ensureSample(owner, server.actions);
  const workspace = await server.workspace.snapshot(owner);
  const mail = workspace.mail.find((message) => message.attachments.length);
  assert.ok(mail);
  const task = await server.agent.createTask(owner, {
    prompt: "Fill the sample form",
    kind: "document",
    input: { messageId: mail.id, fields: { participant_name: "Sample Student" } },
  });
  const compareAndSwap = db.compareAndSwap.bind(db);
  let interrupted = false;
  t.mock.method(db, "compareAndSwap", async (...args: Parameters<Store["compareAndSwap"]>) => {
    const [recordOwner, kind, id, , patch] = args;
    if (
      recordOwner === owner &&
      kind === "tasks" &&
      id === task.id &&
      (patch.state as AgentTask["state"] | undefined)?.filledId &&
      !interrupted
    ) {
      interrupted = true;
      return null;
    }
    return compareAndSwap(...args);
  });

  await server.agent.worker.tick();
  assert.ok(interrupted);
  const retry = await server.agent.getTask(owner, task.id);
  assert.equal(retry.status, "queued");
  assert.equal(retry.state.filledId, undefined);
  const outputs = (await db.list<Artifact>(owner, "files")).filter((file) => file.parentId);
  assert.equal(outputs.length, 1);

  await server.agent.worker.tick();
  const resumed = await server.agent.getTask(owner, task.id);
  assert.equal(resumed.status, "waiting_approval", resumed.error ?? resumed.question);
  assert.equal(resumed.state.filledId, outputs[0].id);
  assert.equal(
    (await db.list<Artifact>(owner, "files")).filter((file) => file.parentId).length,
    1,
  );
});

test("attachment import recovers after mapping loss and isolates reconnections", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "openmuse-attachment-replay-"));
  const db = await createStore();
  const server = await createApp(db, config(directory));
  t.after(async () => {
    await server.agent.stop();
    await db.close();
    await rm(directory, { recursive: true, force: true });
  });

  const owner = "attachment-recovery";
  await server.workspace.ensureSample(owner, server.actions);
  const workspace = await server.workspace.snapshot(owner);
  const mail = workspace.mail.find((message) => message.attachments.length);
  assert.ok(mail);
  const reference = `${mail.id}:sample-attachment:sample.pdf`;
  await db.put(owner, "mail", {
    ...mail,
    attachments: [reference],
    connectionId: "sample-google",
  });

  const google = server.workspace.google(owner);
  const bytes = await createSamplePdf();
  t.mock.method(google, "getAttachment", async () => bytes);
  t.mock.method(server.workspace, "google", () => google);
  const put = db.put.bind(db);
  let interrupted = false;
  t.mock.method(db, "put", async (...args: Parameters<Store["put"]>) => {
    if (args[0] === owner && args[1] === "imports" && !interrupted) {
      interrupted = true;
      throw new Error("mapping unavailable");
    }
    return put(...args);
  });

  const before = await server.files.list(owner);
  await assert.rejects(server.workspace.importAttachment(owner, reference), /mapping unavailable/);
  const published = (await server.files.list(owner)).find(
    (file) => !before.some((old) => old.id === file.id),
  );
  assert.ok(published);

  const recovered = await server.workspace.importAttachment(owner, reference);
  assert.equal(recovered.id, published.id);
  assert.equal((await server.files.list(owner)).length, before.length + 1);

  await db.put(owner, "settings", { id: "google", connectionId: "new-connection" });
  await db.put(owner, "mail", {
    ...mail,
    attachments: [reference],
    connectionId: "new-connection",
  });
  assert.notEqual((await server.workspace.importAttachment(owner, reference)).id, recovered.id);
});
