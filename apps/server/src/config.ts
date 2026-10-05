import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

if (existsSync(".env")) process.loadEnvFile(".env");
process.env.DO_NOT_TRACK ??= "1";
process.env.COPILOTKIT_TELEMETRY_DISABLED ??= "true";

export interface Config {
  mode: "sample" | "live";
  deployment?: "rhodiz";
  webDir?: string;
  port: number;
  host: string;
  publicUrl: string;
  dataDir: string;
  databaseUrl?: string;
  accessKey?: string;
  encryptionKey?: string;
  model?: string;
  agentBackend: "sample" | "model" | "agui";
  authBackend?: "local" | "rhodiz";
  rhodizApiUrl?: string;
  agentUrl?: string;
  agentToken?: string;
  intelligenceApiKey?: string;
  googleClientId?: string;
  googleClientSecret?: string;
  googleRedirectUri: string;
  workerUrl?: string;
  workerToken?: string;
  taskWorkerEnabled?: boolean;
  computerEnabled?: boolean;
  computerImage?: string;
  computerDeploymentId?: string;
  allowedOrigins: string[];
}

const missingIntelligenceKeyMessage =
  "Live mode requires CPK_INTELLIGENCE_API_KEY for durable Rich Threads. " +
  "Run `npx copilotkit@latest login` and `npx copilotkit@latest project select`, " +
  "then set the generated server-only key. " +
  "See https://docs.copilotkit.ai/intelligence/connect-your-runtime";

export function shouldStartLocalTaskWorker(config: Config): boolean {
  return config.authBackend !== "rhodiz" && config.taskWorkerEnabled !== false;
}

export function assertApiDeploymentConfig(config: Config): void {
  assertRhodizDeployment(config);
  if (
    config.mode === "live" &&
    config.authBackend !== "rhodiz" &&
    !config.intelligenceApiKey?.trim()
  ) {
    throw new Error(missingIntelligenceKeyMessage);
  }
}

function encryptionKey(env: NodeJS.ProcessEnv): string | undefined {
  const value = env.TOKEN_ENCRYPTION_KEY;
  const file = env.TOKEN_ENCRYPTION_KEY_FILE;
  if (file === undefined) return value;
  if (value !== undefined)
    throw new Error("Set TOKEN_ENCRYPTION_KEY or TOKEN_ENCRYPTION_KEY_FILE, not both");
  let key: string;
  try {
    const info = statSync(file);
    if (!info.isFile() || info.size > 256) throw new Error("Invalid secret file");
    key = readFileSync(file, "utf8").trim();
  } catch {
    throw new Error("TOKEN_ENCRYPTION_KEY_FILE could not be read as a small regular file");
  }
  if (!key) throw new Error("TOKEN_ENCRYPTION_KEY_FILE must not be empty");
  return key;
}

export function assertRhodizDeployment(config: Config): void {
  if (config.deployment !== "rhodiz") return;
  if (config.mode !== "live" || config.authBackend !== "rhodiz" || config.agentBackend !== "agui")
    throw new Error("RHODIZ deployment requires live mode, RHODIZ auth and the AG-UI bridge");
  if (
    config.taskWorkerEnabled !== false ||
    config.computerEnabled ||
    config.workerUrl ||
    config.workerToken ||
    config.agentToken ||
    config.intelligenceApiKey
  )
    throw new Error(
      "RHODIZ deployment cannot configure a local worker, Computer or alternate agent authority",
    );
  if (!config.webDir) throw new Error("RHODIZ deployment requires OPENMUSE_WEB_DIR");
  const key = config.encryptionKey ?? "";
  if (
    Buffer.from(key, "base64").length !== 32 ||
    Buffer.from(key, "base64").toString("base64") !== key
  )
    throw new Error("RHODIZ deployment requires a canonical 32-byte base64 encryption key");
  for (const value of [config.publicUrl, config.rhodizApiUrl, config.agentUrl]) {
    if (!value)
      throw new Error("RHODIZ deployment requires explicit public and canonical API URLs");
    const url = new URL(value);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error(
        "RHODIZ deployment URLs must be HTTP(S), without credentials, queries or fragments",
      );
  }
  if (config.agentUrl !== `${config.rhodizApiUrl}/api/rhodiz/openmuse/agui`)
    throw new Error("AGENT_URL must use the canonical RHODIZ OpenMuse AG-UI endpoint");
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const deployment = env.OPENMUSE_DEPLOYMENT;
  if (deployment !== undefined && deployment !== "rhodiz")
    throw new Error("OPENMUSE_DEPLOYMENT must be rhodiz when specified");
  const mode = env.WORKSPACE_MODE ?? "sample";
  if (mode !== "sample" && mode !== "live")
    throw new Error("WORKSPACE_MODE must be sample or live");
  const backend = env.AGENT_BACKEND ?? (mode === "sample" ? "sample" : "model");
  if (backend !== "sample" && backend !== "model" && backend !== "agui")
    throw new Error("AGENT_BACKEND must be sample, model or agui");
  const authBackend = env.AUTH_BACKEND ?? "local";
  if (authBackend !== "local" && authBackend !== "rhodiz")
    throw new Error("AUTH_BACKEND must be local or rhodiz");
  if (mode === "live" && backend === "sample")
    throw new Error("Live workspaces cannot use the sample agent");
  if (authBackend === "rhodiz" && backend !== "agui")
    throw new Error("AUTH_BACKEND=rhodiz requires AGENT_BACKEND=agui");
  const port = Number(env.PORT ?? 8787);
  if (deployment === "rhodiz" && env.PUBLIC_API_URL === undefined)
    throw new Error("RHODIZ deployment requires PUBLIC_API_URL");
  const publicUrl = env.PUBLIC_API_URL ?? `http://localhost:${port}`;
  const config: Config = {
    mode,
    deployment,
    webDir: env.OPENMUSE_WEB_DIR ? resolve(env.OPENMUSE_WEB_DIR) : undefined,
    port,
    host: env.HOST ?? "127.0.0.1",
    publicUrl,
    dataDir: resolve(env.DATA_DIR ?? ".openmuse"),
    databaseUrl: env.DATABASE_URL,
    accessKey: env.OPENMUSE_ACCESS_KEY,
    encryptionKey: encryptionKey(env),
    model: env.MODEL,
    agentBackend: backend,
    authBackend,
    rhodizApiUrl: env.RHODIZ_API_URL?.replace(/\/$/, ""),
    agentUrl: env.AGENT_URL,
    agentToken: env.AGENT_TOKEN,
    intelligenceApiKey: env.CPK_INTELLIGENCE_API_KEY,
    googleClientId: env.GOOGLE_CLIENT_ID,
    googleClientSecret: env.GOOGLE_CLIENT_SECRET,
    googleRedirectUri: `${publicUrl}/api/google/callback`,
    workerUrl: env.BROWSER_WORKER_URL,
    workerToken: env.WORKER_TOKEN,
    taskWorkerEnabled: env.TASK_WORKER_ENABLED !== "false",
    computerEnabled: env.COMPUTER_ENABLED === "true",
    computerImage: env.COMPUTER_IMAGE ?? "openmuse-computer:local",
    computerDeploymentId: env.COMPUTER_DEPLOYMENT_ID,
    allowedOrigins: (env.ALLOWED_ORIGINS ?? "http://localhost:8081,http://127.0.0.1:8081").split(
      ",",
    ),
  };
  if (authBackend === "rhodiz" && !config.rhodizApiUrl)
    throw new Error("AUTH_BACKEND=rhodiz requires RHODIZ_API_URL");
  if (authBackend === "rhodiz" && !config.agentUrl)
    throw new Error("AUTH_BACKEND=rhodiz requires AGENT_URL for the RHODIZ AG-UI bridge");
  if (mode === "live" && !config.encryptionKey)
    throw new Error("Live mode requires TOKEN_ENCRYPTION_KEY (32-byte base64)");
  if (
    mode === "live" &&
    authBackend === "local" &&
    (!config.accessKey || config.accessKey.length < 24)
  )
    throw new Error("Local live mode requires OPENMUSE_ACCESS_KEY (24+ characters)");
  if (mode === "sample" && !["127.0.0.1", "localhost", "::1"].includes(config.host))
    throw new Error("Sample workspace is local-only. HOST must be a loopback address.");
  assertRhodizDeployment(config);
  return config;
}
