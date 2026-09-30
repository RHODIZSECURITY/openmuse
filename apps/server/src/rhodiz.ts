import type { AgentIdentity, AgentMemory } from "../../../packages/domain/src/agent.ts";
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
    if (response.status === 409) throw new AppError("RHODIZ item changed; refresh and try again", 409);
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
  return rhodizRequest<{ id: string; ok: boolean }>(config, authorization, "/api/memoria/recuerdos", {
    method: "POST",
    body: JSON.stringify({
      tipo: "manual",
      contenido: text,
      etiquetas: ["manual", "openmuse"],
      fuerza: 1,
    }),
  });
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
