import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  isRhodizPc,
  RHODIZ_PC_TABS,
  rhodizPcTabs,
  rhodizPcWorkspaceConnected,
} from "../apps/mobile/src/rhodiz-pc.ts";
import type { Workspace } from "../packages/domain/src/index.ts";

type Runtime = Workspace["runtime"];

function runtime(overrides: Partial<Runtime> = {}): Runtime {
  return {
    provider: "model",
    configured: true,
    openbotConfigured: false,
    ...overrides,
  };
}

test("RHODIZ PC identity is independent from the browser backend", () => {
  const value = runtime({
    computerBackend: "rhodiz",
    computerStatus: "disabled",
    browserBackend: "openmuse",
    browserStatus: "connected",
  });
  assert.equal(isRhodizPc(value), true);
  assert.equal(rhodizPcWorkspaceConnected(value), false);
  assert.deepEqual(rhodizPcTabs(value), ["Browser"]);
});

test("RHODIZ PC exposes Terminal and Files only after the governed workspace connects", () => {
  for (const status of ["disabled", "offline", "forbidden"] as const)
    assert.deepEqual(rhodizPcTabs(runtime({ computerBackend: "rhodiz", computerStatus: status })), [
      "Browser",
    ]);

  const connected = runtime({ computerBackend: "rhodiz", computerStatus: "connected" });
  assert.equal(rhodizPcWorkspaceConnected(connected), true);
  assert.deepEqual(rhodizPcTabs(connected), RHODIZ_PC_TABS);

  assert.deepEqual(
    rhodizPcTabs(runtime({ computerBackend: "openmuse", computerStatus: "connected" })),
    RHODIZ_PC_TABS,
  );
});

test("RHODIZ mode presents RHODIZ PC while local OpenMuse effects remain fail-closed", async () => {
  const computer = await readFile(
    new URL("../apps/mobile/src/computer.tsx", import.meta.url),
    "utf8",
  );
  assert.match(computer, /RHODIZ PC — take control/);
  assert.match(computer, /rhodizPc \? "RHODIZ PC" : "Computer"/);
  assert.match(computer, /title=\{rhodizPc \? "RHODIZ PC" : "Agent computer"\}/);
  assert.match(computer, /This RHODIZ account is not authorized for the RHODIZ PC browser/);
  assert.match(computer, /Enable the RHODIZ PC browser from its canonical Admin configuration/);
  assert.match(computer, /The RHODIZ PC browser is configured but its sidecar is unavailable/);
  assert.match(computer, /rhodizPc \? "Refresh RHODIZ PC" : "Refresh computer"/);
  assert.match(computer, /rhodizPcTabs\(workspace\.runtime\)/);
  assert.match(
    computer,
    /OpenMuse relays explicit confirmation tickets but never authorizes an effect itself/,
  );

  const threads = await readFile(
    new URL("../apps/mobile/src/threads.tsx", import.meta.url),
    "utf8",
  );
  assert.match(threads, /"RHODIZ PC"/);
  assert.match(threads, /Browser now; governed workspace, Terminal and Files next/);

  for (const file of ["agent-ui.tsx", "screens.tsx"]) {
    const value = await readFile(new URL(`../apps/mobile/src/${file}`, import.meta.url), "utf8");
    assert.match(value, /RHODIZ PC/);
    assert.match(value, /isRhodizPc/);
  }
});
