import { existsSync } from "node:fs";
import { resolve } from "node:path";

if (existsSync(".env")) process.loadEnvFile(".env");
process.env.DO_NOT_TRACK ??= "1";
process.env.COPILOTKIT_TELEMETRY_DISABLED ??= "true";

export interface Config {
  mode: "sample" | "live";
  port: number;
  host: string;
  publicUrl: string;
  dataDir: string;
  databaseUrl?: string;
  accessKey?: string;
  encryptionKey?: string;
  model?: string;
  agentBackend: "sample" | "model" | "agui";
  authBackend: "local" | "rhodiz";
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

export function assertApiDeploymentConfig(config: Config): void {
  if (config.mode === "live" && !config.intelligenceApiKey?.trim()) {
    throw new Error(missingIntelligenceKeyMessage);
  }
}

export function readConfig(): Config {
  const mode = process.env.WORKSPACE_MODE ?? "sample";
  if (mode !== "sample" && mode !== "live")
    throw new Error("WORKSPACE_MODE must be sample or live");
  const backend = process.env.AGENT_BACKEND ?? (mode === "sample" ? "sample" : "model");
  if (backend !== "sample" && backend !== "model" && backend !== "agui")
    throw new Error("AGENT_BACKEND must be sample, model or agui");
  const authBackend = process.env.AUTH_BACKEND ?? "local";
  if (authBackend !== "local" && authBackend !== "rhodiz")
    throw new Error("AUTH_BACKEND must be local or rhodiz");
  if (mode === "live" && backend === "sample")
    throw new Error("Live workspaces cannot use the sample agent");
  if (authBackend === "rhodiz" && backend !== "agui")
    throw new Error("AUTH_BACKEND=rhodiz requires AGENT_BACKEND=agui");
  const port = Number(process.env.PORT ?? 8787);
  const publicUrl = process.env.PUBLIC_API_URL ?? `http://localhost:${port}`;
  const config: Config = {
    mode,
    port,
    host: process.env.HOST ?? "127.0.0.1",
    publicUrl,
    dataDir: resolve(process.env.DATA_DIR ?? ".openmuse"),
    databaseUrl: process.env.DATABASE_URL,
    accessKey: process.env.OPENMUSE_ACCESS_KEY,
    encryptionKey: process.env.TOKEN_ENCRYPTION_KEY,
    model: process.env.MODEL,
    agentBackend: backend,
    authBackend,
    rhodizApiUrl: process.env.RHODIZ_API_URL?.replace(/\/$/, ""),
    agentUrl: process.env.AGENT_URL,
    agentToken: process.env.AGENT_TOKEN,
    intelligenceApiKey: process.env.CPK_INTELLIGENCE_API_KEY,
    googleClientId: process.env.GOOGLE_CLIENT_ID,
    googleClientSecret: process.env.GOOGLE_CLIENT_SECRET,
    googleRedirectUri: `${publicUrl}/api/google/callback`,
    workerUrl: process.env.BROWSER_WORKER_URL,
    workerToken: process.env.WORKER_TOKEN,
    taskWorkerEnabled: process.env.TASK_WORKER_ENABLED !== "false",
    computerEnabled: process.env.COMPUTER_ENABLED === "true",
    computerImage: process.env.COMPUTER_IMAGE ?? "openmuse-computer:local",
    computerDeploymentId: process.env.COMPUTER_DEPLOYMENT_ID,
    allowedOrigins: (
      process.env.ALLOWED_ORIGINS ?? "http://localhost:8081,http://127.0.0.1:8081"
    ).split(","),
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
  return config;
}
