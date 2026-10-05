import { stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";

if (process.env.EXPO_PUBLIC_WEB_BASE_PATH === undefined)
  throw new Error("Set EXPO_PUBLIC_WEB_BASE_PATH explicitly when building a RHODIZ web artifact");
const require = createRequire(import.meta.url);
const config = require("../apps/mobile/app.config.js")({ config: {} });
const directory = new URL("../apps/mobile/dist/web/", import.meta.url);
await stat(new URL("index.html", directory));
await writeFile(
  new URL("rhodiz-web.json", directory),
  `${JSON.stringify({ version: 1, basePath: config.experiments.baseUrl }, null, 2)}\n`,
);
