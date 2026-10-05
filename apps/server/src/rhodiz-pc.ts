import { z } from "zod";
import type { Config } from "./config.ts";
import { AppError } from "./errors.ts";

export type RhodizPcState = "connected" | "offline" | "disabled" | "forbidden";

const snapshotSchema = z.object({
  enabled: z.literal(true),
  provider: z.literal("rhodiz"),
  protocolVersion: z.literal(1),
  openmuseBridgeReady: z.literal(true),
  status: z.enum(["unconfigured", "stopped", "running", "error"]),
  workspacePath: z.literal("/workspace"),
  network: z.literal("disabled"),
});

function bearerToken(authorization?: string): string {
  if (!authorization?.startsWith("Bearer ")) throw new AppError("Sign in to RHODIZ", 401);
  const token = authorization.slice(7).trim();
  if (!token) throw new AppError("Sign in to RHODIZ", 401);
  return token;
}

/**
 * Read-only RHODIZ PC control-plane probe.
 *
 * This never talks to the privileged Manager directly. It calls the canonical
 * RHODIZ API, forwarding only the authenticated bearer. A valid snapshot means
 * the bridge is connected even when the workbench lifecycle itself is stopped.
 */
export async function rhodizPcState(
  config: Config,
  authorization?: string,
): Promise<RhodizPcState> {
  if (config.authBackend !== "rhodiz" || !config.rhodizApiUrl) return "disabled";
  const token = bearerToken(authorization);
  let response: Response;
  try {
    response = await fetch(`${config.rhodizApiUrl}/api/rhodiz/pc`, {
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

  const parsed = snapshotSchema.safeParse(await response.json().catch(() => null));
  return parsed.success ? "connected" : "offline";
}
