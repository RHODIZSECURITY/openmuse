import { createHash } from "node:crypto";
import type {
  AgentIdentity,
  AgentMemory,
  AgentNotification,
  AgentTask,
} from "../../../packages/domain/src/agent.ts";
import type { Config } from "./config.ts";
import { AppError } from "./errors.ts";

type RhodizMemory = {
  id?: unknown;
  contenido?: unknown;
  tipo?: unknown;
  creado_en?: unknown;
  version?: unknown;
};

type RhodizSession = {
  user_id?: unknown;
  usuario?: unknown;
  perfil?: unknown;
};

type RhodizTask = {
  id?: unknown;
  prompt?: unknown;
  estado?: unknown;
  resultado?: unknown;
  ticket_pendiente?: unknown;
  accion_pendiente?: unknown;
  ultimo_error?: unknown;
  usar_memoria?: unknown;
  permitir_herramientas?: unknown;
  pasos_totales?: unknown;
  pasos_completados?: unknown;
  creado_en?: unknown;
  actualizado_en?: unknown;
};

type RhodizNotice = {
  clave?: unknown;
  nivel?: unknown;
  titulo?: unknown;
  detalle?: unknown;
  ts?: unknown;
};

function bearer(authorization?: string) {
  if (!authorization?.startsWith("Bearer ")) throw new AppError("Sign in to RHODIZ", 401);
  return authorization;
}

async function rhodizRequest<T>(
  config: Config,
  authorization: string | undefined,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  if (config.authBackend !== "rhodiz" || !config.rhodizApiUrl)
    throw new AppError("RHODIZ integration is not configured", 503);
  let response: Response;
  try {
    response = await fetch(`${config.rhodizApiUrl}${path}`, {
      ...init,
      headers: {
        Authorization: bearer(authorization),
        "x-rhodiz-token": authorization?.slice(7).trim() ?? "",
        ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
        ...init.headers,
      },
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    throw new AppError("RHODIZ is unavailable", 503);
  }
  if (!response.ok) {
    if (response.status === 401 || response.status === 403)
      throw new AppError("RHODIZ session expired. Sign in again.", 401);
    if (response.status === 404) throw new AppError("RHODIZ item not found", 404);
    if (response.status === 409)
      throw new AppError("RHODIZ item changed; refresh and try again", 409);
    throw new AppError("RHODIZ request failed", response.status >= 500 ? 503 : 422);
  }
  try {
    return (await response.json()) as T;
  } catch {
    throw new AppError("RHODIZ returned an invalid response", 502);
  }
}

function createdAt(value: unknown): string {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return new Date(0).toISOString();
  return new Date(seconds * 1000).toISOString();
}

function dateValue(value: unknown): string {
  if (typeof value === "number" || (typeof value === "string" && /^\d+(?:\.\d+)?$/.test(value)))
    return createdAt(value);
  if (typeof value === "string") {
    const millis = Date.parse(value);
    if (Number.isFinite(millis)) return new Date(millis).toISOString();
  }
  return new Date(0).toISOString();
}

function stableProjectionId(prefix: string, ...parts: string[]) {
  return `${prefix}-${createHash("sha256").update(parts.join("\x1f")).digest("hex").slice(0, 32)}`;
}

function taskStatus(task: RhodizTask): AgentTask["status"] {
  const state = String(task.estado ?? "");
  const approval =
    state === "pausada" &&
    (Boolean(String(task.ticket_pendiente ?? "").trim()) ||
      Boolean(String(task.accion_pendiente ?? "").trim()));
  if (approval) return "waiting_approval";
  switch (state) {
    case "pendiente":
      return "queued";
    case "ejecutando":
      return "running";
    case "pausada":
      return "paused";
    case "completada":
      return "succeeded";
    case "fallida":
      return "failed";
    case "cancelada":
      return "cancelled";
    default:
      return "paused";
  }
}

function taskProjection(task: RhodizTask): AgentTask | null {
  const id = typeof task.id === "string" ? task.id.trim() : "";
  const prompt = typeof task.prompt === "string" ? task.prompt : "";
  if (!id || !prompt.trim()) return null;
  const status = taskStatus(task);
  const result = typeof task.resultado === "string" ? task.resultado : "";
  const error = typeof task.ultimo_error === "string" ? task.ultimo_error : "";
  const approvalRequired = status === "waiting_approval";
  const title = prompt.replace(/\s+/g, " ").trim().slice(0, 160) || "RHODIZ task";
  return {
    id,
    title,
    prompt,
    kind: "agent",
    status,
    plan: [],
    evidence: [],
    input: { canonical: "rhodiz" },
    state: {
      canonical: "rhodiz",
      approvalRequired,
      toolsAllowed: Boolean(task.permitir_herramientas),
      memoryEnabled: Boolean(task.usar_memoria),
      stepsTotal: Number(task.pasos_totales) || 0,
      stepsCompleted: Number(task.pasos_completados) || 0,
    },
    createdAt: createdAt(task.creado_en),
    updatedAt: createdAt(task.actualizado_en),
    attempts: 0,
    result: result || undefined,
    error: error || null,
    question: approvalRequired ? "RHODIZ approval is required to continue this task." : undefined,
    artifactIds: [],
  };
}

function noticeProjection(notice: RhodizNotice): AgentNotification | null {
  const title = typeof notice.titulo === "string" ? notice.titulo.trim() : "";
  const body = typeof notice.detalle === "string" ? notice.detalle.trim() : "";
  const key = typeof notice.clave === "string" ? notice.clave : "";
  const ts = dateValue(notice.ts);
  if (!title || !body) return null;
  return {
    id: stableProjectionId("rhodiz-notice", key, ts, title, body),
    title,
    body,
    createdAt: ts,
    read: false,
  };
}

export async function rhodizExperienceProjection(
  config: Config,
  authorization?: string,
): Promise<{
  identity: AgentIdentity;
  memories: AgentMemory[];
}> {
  const [session, memory] = await Promise.all([
    rhodizRequest<RhodizSession>(config, authorization, "/api/rhodiz/sesion"),
    rhodizRequest<{ recuerdos?: RhodizMemory[] }>(config, authorization, "/api/memoria/buscar?q="),
  ]);
  const profile =
    session.perfil && typeof session.perfil === "object" && !Array.isArray(session.perfil)
      ? (session.perfil as Record<string, unknown>)
      : {};
  const toneValue = String(profile.rhodiz_tone ?? profile.tono ?? "").toLowerCase();
  const tone: AgentIdentity["tone"] =
    toneValue === "warm" || toneValue === "thoughtful" || toneValue === "concise"
      ? toneValue
      : "concise";
  return {
    identity: {
      name: "RHODIZ IA",
      tone,
      avatar: "sky",
      showChatUpdates: true,
    },
    memories: (memory.recuerdos ?? []).flatMap((item) => {
      const id = typeof item.id === "string" ? item.id : "";
      const text = typeof item.contenido === "string" ? item.contenido : "";
      if (!id || !text) return [];
      const version = Number(item.version);
      return [
        {
          id,
          text,
          source: `MemoryOS · ${typeof item.tipo === "string" ? item.tipo : "memory"}`,
          createdAt: createdAt(item.creado_en),
          ...(Number.isInteger(version) && version > 0 ? { version } : {}),
        },
      ];
    }),
  };
}

export async function rhodizCreateMemory(
  config: Config,
  authorization: string | undefined,
  text: string,
) {
  return rhodizRequest<{ id: string; ok: boolean }>(
    config,
    authorization,
    "/api/memoria/recuerdos",
    {
      method: "POST",
      body: JSON.stringify({
        tipo: "manual",
        contenido: text,
        etiquetas: ["manual", "openmuse"],
        fuerza: 1,
      }),
    },
  );
}

export async function rhodizForgetMemory(
  config: Config,
  authorization: string | undefined,
  id: string,
  version: number,
) {
  const query = new URLSearchParams({ version_esperada: String(version) });
  return rhodizRequest<{ ok: boolean; id: string; version: number }>(
    config,
    authorization,
    `/api/memoria/recuerdos/${encodeURIComponent(id)}?${query}`,
    { method: "DELETE" },
  );
}

export async function rhodizWorkProjection(
  config: Config,
  authorization?: string,
): Promise<{
  tasks: AgentTask[];
  notifications: AgentNotification[];
  worker: { running: boolean };
}> {
  const [taskPayload, noticePayload] = await Promise.all([
    rhodizRequest<{ tareas?: RhodizTask[] }>(config, authorization, "/api/rhodiz/tareas"),
    rhodizRequest<{ avisos?: RhodizNotice[] }>(
      config,
      authorization,
      "/api/rhodiz/proactividad/avisos?limite=50",
    ),
  ]);
  const tasks = (taskPayload.tareas ?? []).flatMap((task) => {
    const projected = taskProjection(task);
    return projected ? [projected] : [];
  });
  const notifications = (noticePayload.avisos ?? []).flatMap((notice) => {
    const projected = noticeProjection(notice);
    return projected ? [projected] : [];
  });
  return {
    tasks,
    notifications,
    worker: { running: tasks.some((task) => task.status === "running") },
  };
}

export async function rhodizTaskDetail(
  config: Config,
  authorization: string | undefined,
  id: string,
) {
  const task = await rhodizRequest<RhodizTask>(
    config,
    authorization,
    `/api/rhodiz/tareas/${encodeURIComponent(id)}`,
  );
  const projected = taskProjection(task);
  if (!projected) throw new AppError("RHODIZ returned an invalid task", 502);
  return { ...projected, files: [], browsers: [], events: [], artifacts: [] };
}

export async function rhodizCancelTask(
  config: Config,
  authorization: string | undefined,
  id: string,
) {
  return rhodizRequest<{ ok: boolean; estado: string }>(
    config,
    authorization,
    `/api/rhodiz/tareas/${encodeURIComponent(id)}/cancelar`,
    { method: "POST" },
  );
}
