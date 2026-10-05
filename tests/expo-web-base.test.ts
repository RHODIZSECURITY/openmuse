import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { normalizeWebBasePath } from "../apps/mobile/src/api-url.ts";

const require = createRequire(import.meta.url);
const configure = require("../apps/mobile/app.config.js");
function withBase(value: string | undefined, run: () => void) {
  const before = process.env.EXPO_PUBLIC_WEB_BASE_PATH;
  try {
    if (value === undefined) delete process.env.EXPO_PUBLIC_WEB_BASE_PATH;
    else process.env.EXPO_PUBLIC_WEB_BASE_PATH = value;
    run();
  } finally {
    if (before === undefined) delete process.env.EXPO_PUBLIC_WEB_BASE_PATH;
    else process.env.EXPO_PUBLIC_WEB_BASE_PATH = before;
  }
}

test("Expo base configuration is opt-in and preserves native and existing configuration", () => {
  const config = {
    name: "OpenMuse",
    ios: { supportsTablet: true },
    experiments: { typedRoutes: false },
  };
  withBase(undefined, () => assert.equal(configure({ config }), config));
  for (const path of ["", "/", "/muse", "/muse/", "/tenant/muse"])
    withBase(path, () => {
      const result = configure({ config });
      assert.equal(result.experiments.baseUrl, normalizeWebBasePath(path));
      assert.equal(result.experiments.typedRoutes, false);
      assert.deepEqual(result.ios, config.ios);
    });
});

test("Expo rejects the same invalid deployment paths as the API client", () => {
  for (const path of [
    "muse",
    "//other.invalid",
    "https://other.invalid",
    "/muse?x=1",
    "/muse#x",
    "/../muse",
    "/muse//x",
    "/muse%2Fx",
    "/muse\\x",
  ])
    withBase(path, () => {
      assert.throws(() => configure({ config: {} }));
      assert.throws(() => normalizeWebBasePath(path));
    });
});
