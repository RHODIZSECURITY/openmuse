import { z } from "zod";
import type { BrowserSession } from "../../../packages/domain/src/index.ts";
import type { Config } from "./config.ts";
import { AppError } from "./errors.ts";

export type RhodizBrowserState = "connected" | "offline" | "disabled" | "forbidden";

const statusSchema = z.object({
  configurado: z.boolean(),
  disponible: z.boolean().optional().default(false),
});
const sessionsSchema = z.object({
  sessions: z
    .array(
      z.object({
        id: z
          .string()
          .min(1)
          .max(128)
          .regex(/^[A-Za-z0-9_-]+$/),
        title: z.string().max(500),
        url: z.string().max(4096),
        status: z.enum(["active", "idle"]),
        created: z.number().finite(),
        touched: z.number().finite(),
      }),
    )
    .max(512),
});
const previewSchema = z.object({
  mime: z.literal("image/png"),
  base64: z.string().max(16 * 1024 * 1024),
  bytes: z
    .number()
    .int()
    .min(0)
    .max(12 * 1024 * 1024),
});

function bearerToken(authorization?: string): string {
  if (!authorization?.startsWith("Bearer ")) throw new AppError("Sign in to RHODIZ", 401);
  const token = authorization.slice(7).trim();
  if (!token) throw new AppError("Sign in to RHODIZ", 401);
  return token;
}

export async function rhodizBrowserState(
  config: Config,
  authorization?: string,
): Promise<RhodizBrowserState> {
  if (config.authBackend !== "rhodiz" || !config.rhodizApiUrl) return "disabled";
  const token = bearerToken(authorization);
  let response: Response;
  try {
    response = await fetch(`${config.rhodizApiUrl}/api/rhodiz/computer/estado`, {
      headers: { "x-rhodiz-token": token },
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    return "offline";
  }
  if (response.status === 401) throw new AppError("RHODIZ session expired. Sign in again.", 401);
  if (response.status === 403) return "forbidden";
  if (response.status === 404) return "disabled";
  if (!response.ok) return "offline";

  const payload = statusSchema.safeParse(await response.json().catch(() => null));
  if (!payload.success) return "offline";
  if (!payload.data.configurado) return "disabled";
  return payload.data.disponible ? "connected" : "offline";
}

function rhodizHeaders(authorization?: string): Record<string, string> {
  return { "x-rhodiz-token": bearerToken(authorization) };
}

export async function rhodizBrowserSessions(
  config: Config,
  authorization?: string,
): Promise<BrowserSession[]> {
  if (config.authBackend !== "rhodiz" || !config.rhodizApiUrl) return [];
  let response: Response;
  try {
    response = await fetch(`${config.rhodizApiUrl}/api/rhodiz/computer/sesiones`, {
      headers: rhodizHeaders(authorization),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    throw new AppError("RHODIZ browser sessions are unavailable", 503);
  }
  if (response.status === 401) throw new AppError("RHODIZ session expired. Sign in again.", 401);
  if (response.status === 403)
    throw new AppError("This RHODIZ account cannot use Computer-use", 403);
  if (response.status === 404) return [];
  if (!response.ok) throw new AppError("RHODIZ browser sessions are unavailable", 503);

  const parsed = sessionsSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) throw new AppError("RHODIZ browser returned an invalid session list", 502);
  return parsed.data.sessions.map((session) => ({
    id: session.id,
    title: session.title || "RHODIZ browser",
    url: session.url,
    status: session.status,
    updatedAt: new Date(session.touched * 1000).toISOString(),
    previewUrl: `/api/rhodiz-browser/${encodeURIComponent(session.id)}/preview`,
  }));
}

export async function rhodizBrowserPreview(
  config: Config,
  authorization: string | undefined,
  sessionId: string,
): Promise<Buffer> {
  if (config.authBackend !== "rhodiz" || !config.rhodizApiUrl)
    throw new AppError("RHODIZ browser is not configured", 503);
  const safeId = z
    .string()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9_-]+$/)
    .parse(sessionId);
  let response: Response;
  try {
    response = await fetch(
      `${config.rhodizApiUrl}/api/rhodiz/computer/sesiones/${encodeURIComponent(safeId)}/captura`,
      {
        headers: rhodizHeaders(authorization),
        signal: AbortSignal.timeout(5000),
      },
    );
  } catch {
    throw new AppError("RHODIZ browser preview is unavailable", 503);
  }
  if (response.status === 401) throw new AppError("RHODIZ session expired. Sign in again.", 401);
  if (response.status === 403)
    throw new AppError("This RHODIZ account cannot use Computer-use", 403);
  if (response.status === 404) throw new AppError("RHODIZ browser session not found", 404);
  if (!response.ok) throw new AppError("RHODIZ browser preview is unavailable", 503);

  const parsed = previewSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) throw new AppError("RHODIZ browser returned an invalid preview", 502);
  if (parsed.data.base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(parsed.data.base64))
    throw new AppError("RHODIZ browser returned invalid preview encoding", 502);
  const bytes = Buffer.from(parsed.data.base64, "base64");
  if (bytes.length !== parsed.data.bytes)
    throw new AppError("RHODIZ browser preview length did not match its receipt", 502);
  return bytes;
}

export type RhodizBrowserConfirmation = {
  confirmacion_requerida: true;
  ticket: string;
  accion: string;
};

function confirmationSchema() {
  return z.object({
    confirmacion_requerida: z.literal(true),
    ticket: z.string().min(1).max(8192),
    accion: z.string().min(1).max(120),
  });
}

async function rhodizBrowserCommand(
  config: Config,
  authorization: string | undefined,
  path: string,
  method: "POST" | "DELETE",
  body?: unknown,
  ticket?: string,
): Promise<unknown> {
  if (config.authBackend !== "rhodiz" || !config.rhodizApiUrl)
    throw new AppError("RHODIZ browser is not configured", 503);
  const headers: Record<string, string> = rhodizHeaders(authorization);
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (ticket) headers["x-rhodiz-ticket"] = ticket;
  let response: Response;
  try {
    response = await fetch(`${config.rhodizApiUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw new AppError("RHODIZ browser command is unavailable", 503);
  }
  const payload = await response.json().catch(() => null);
  if (response.status === 401) throw new AppError("RHODIZ session expired. Sign in again.", 401);
  if (response.status === 403)
    throw new AppError("This RHODIZ account cannot use Computer-use", 403);
  if (response.status === 404) throw new AppError("RHODIZ browser session not found", 404);
  if (!response.ok) {
    let status: 400 | 409 | 413 | 422 | 429 | 502 | 503 = 502;
    if (response.status >= 500) status = 503;
    else if (
      response.status === 400 ||
      response.status === 409 ||
      response.status === 413 ||
      response.status === 422 ||
      response.status === 429
    )
      status = response.status;
    throw new AppError(
      typeof payload === "object" && payload && "detail" in payload
        ? String((payload as { detail?: unknown }).detail ?? "RHODIZ browser command failed")
        : "RHODIZ browser command failed",
      status,
    );
  }
  return payload;
}

function browserSessionFromState(
  id: string,
  payload: { title?: unknown; url?: unknown },
): BrowserSession {
  return {
    id,
    title: typeof payload.title === "string" && payload.title ? payload.title : "RHODIZ browser",
    url: typeof payload.url === "string" ? payload.url : "",
    status: "active",
    updatedAt: new Date().toISOString(),
    previewUrl: `/api/rhodiz-browser/${encodeURIComponent(id)}/preview`,
  };
}

export async function rhodizBrowserCreate(
  config: Config,
  authorization: string | undefined,
  input: { viewport_width?: number; viewport_height?: number; locale?: string },
): Promise<BrowserSession> {
  const parsedInput = z
    .object({
      viewport_width: z.number().int().min(320).max(3840).optional(),
      viewport_height: z.number().int().min(240).max(2160).optional(),
      locale: z.string().min(1).max(30).optional(),
    })
    .parse(input);
  const payload = await rhodizBrowserCommand(
    config,
    authorization,
    "/api/rhodiz/computer/sesiones",
    "POST",
    parsedInput,
  );
  const created = z
    .object({
      id: z
        .string()
        .min(1)
        .max(128)
        .regex(/^[A-Za-z0-9_-]+$/),
    })
    .parse(payload);
  const sessions = await rhodizBrowserSessions(config, authorization);
  return (
    sessions.find((session) => session.id === created.id) ?? browserSessionFromState(created.id, {})
  );
}

export async function rhodizBrowserNavigate(
  config: Config,
  authorization: string | undefined,
  sessionId: string,
  input: { url: string; ticket?: string },
): Promise<BrowserSession | RhodizBrowserConfirmation> {
  const safeId = z
    .string()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9_-]+$/)
    .parse(sessionId);
  const parsed = z
    .object({
      url: z.url().max(4096),
      ticket: z.string().min(1).max(8192).optional(),
    })
    .parse(input);
  const payload = await rhodizBrowserCommand(
    config,
    authorization,
    `/api/rhodiz/computer/sesiones/${encodeURIComponent(safeId)}/navegar`,
    "POST",
    { url: parsed.url },
    parsed.ticket,
  );
  const confirmation = confirmationSchema().safeParse(payload);
  if (confirmation.success) return confirmation.data;
  const state = z
    .object({
      url: z.string().max(4096).optional(),
      title: z.string().max(500).optional(),
    })
    .parse(payload);
  return browserSessionFromState(safeId, state);
}

export async function rhodizBrowserAction(
  config: Config,
  authorization: string | undefined,
  sessionId: string,
  input: {
    action:
      | "click"
      | "fill"
      | "press"
      | "select"
      | "scroll"
      | "wait"
      | "back"
      | "forward"
      | "reload";
    selector?: string;
    value?: string;
    key?: string;
    x?: number;
    y?: number;
    timeout_ms?: number;
    ticket?: string;
  },
): Promise<BrowserSession | RhodizBrowserConfirmation> {
  const safeId = z
    .string()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9_-]+$/)
    .parse(sessionId);
  const parsed = z
    .object({
      action: z.enum([
        "click",
        "fill",
        "press",
        "select",
        "scroll",
        "wait",
        "back",
        "forward",
        "reload",
      ]),
      selector: z.string().max(2000).optional(),
      value: z.string().max(20000).optional(),
      key: z.string().max(100).optional(),
      x: z.number().int().optional(),
      y: z.number().int().optional(),
      timeout_ms: z.number().int().min(500).max(60000).optional(),
      ticket: z.string().min(1).max(8192).optional(),
    })
    .parse(input);
  const { ticket, ...action } = parsed;
  const payload = await rhodizBrowserCommand(
    config,
    authorization,
    `/api/rhodiz/computer/sesiones/${encodeURIComponent(safeId)}/accion`,
    "POST",
    action,
    ticket,
  );
  const confirmation = confirmationSchema().safeParse(payload);
  if (confirmation.success) return confirmation.data;
  const state = z
    .object({
      url: z.string().max(4096).optional(),
      title: z.string().max(500).optional(),
    })
    .parse(payload);
  return browserSessionFromState(safeId, state);
}

export async function rhodizBrowserClose(
  config: Config,
  authorization: string | undefined,
  sessionId: string,
): Promise<{ closed: boolean }> {
  const safeId = z
    .string()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9_-]+$/)
    .parse(sessionId);
  const payload = await rhodizBrowserCommand(
    config,
    authorization,
    `/api/rhodiz/computer/sesiones/${encodeURIComponent(safeId)}`,
    "DELETE",
  );
  return z.object({ closed: z.boolean() }).parse(payload);
}
