import { z } from "zod";
import type { Config } from "./config.ts";
import { AppError } from "./errors.ts";

export type RhodizBrowserState = "connected" | "offline" | "disabled" | "forbidden";

const statusSchema = z.object({
  configurado: z.boolean(),
  disponible: z.boolean().optional().default(false),
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
