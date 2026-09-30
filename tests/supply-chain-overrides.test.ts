import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workspace = readFileSync("pnpm-workspace.yaml", "utf8");
const lock = readFileSync("pnpm-lock.yaml", "utf8");
const metroPatch = readFileSync("patches/metro@0.83.3.patch", "utf8");

test("security overrides remove the audited vulnerable transitive versions", () => {
  for (const line of ["undici@5.29.0: 6.28.1", "image-size@1.2.1: 2.0.3", "uuid@7.0.3: 11.1.1"]) {
    assert.ok(workspace.includes(line), line);
  }

  assert.ok(!lock.includes("\n  undici@5.29.0:\n"));
  assert.ok(!lock.includes("\n  image-size@1.2.1:\n"));
  assert.ok(!lock.includes("\n  uuid@7.0.3:\n"));
});

test("Metro compatibility patch converts the asset path to bytes for image-size 2", () => {
  assert.ok(workspace.includes("metro@0.83.3: patches/metro@0.83.3.patch"));
  assert.match(metroPatch, /^\+.*readFileSync\(assetInfo\.files\[0\]\)/m);
  assert.match(metroPatch, /^-.*assetInfo\.files\[0\]\.includes\("\.zip\/"\)/m);
});
