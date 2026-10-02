import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Config } from "./config.ts";
import type { Store } from "./db.ts";
import { AppError } from "./errors.ts";

const digest = (value: string) => createHash("sha256").update(value).digest();
export class Auth {
  constructor(
    private readonly db: Store,
    private readonly config: Config,
    private readonly signingKey: string,
  ) {}
  async session(
    input?:
      | string
      | { accessKey?: string; usuario?: string; password?: string; dispositivo?: string },
  ) {
    const credentials = typeof input === "string" ? { accessKey: input } : (input ?? {});
    if (this.config.authBackend === "rhodiz") {
      if (!credentials.usuario?.trim() || !credentials.password)
        throw new AppError("RHODIZ username and password are required", 401);
      let response: Response;
      try {
        response = await fetch(`${this.config.rhodizApiUrl}/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            usuario: credentials.usuario.trim(),
            password: credentials.password,
            dispositivo: credentials.dispositivo ?? "OpenMuse",
          }),
          signal: AbortSignal.timeout(5000),
        });
      } catch {
        throw new AppError("RHODIZ authentication is unavailable", 503);
      }
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }
      if (!response.ok) {
        if (response.status === 429)
          throw new AppError("Too many RHODIZ sign-in attempts. Try again later.", 429);
        throw new AppError("RHODIZ credentials are invalid", 401);
      }
      const token =
        payload && typeof payload === "object" && "token" in payload
          ? String((payload as { token?: unknown }).token ?? "")
          : "";
      const owner =
        payload && typeof payload === "object" && "user_id" in payload
          ? String((payload as { user_id?: unknown }).user_id ?? "")
          : "";
      if (!token || !owner) throw new AppError("RHODIZ login returned an invalid session", 502);
      return { token, mode: this.config.mode, owner };
    }

    const accessKey = credentials.accessKey;
    if (
      this.config.mode === "live" &&
      (!accessKey ||
        !this.config.accessKey ||
        !timingSafeEqual(digest(accessKey), digest(this.config.accessKey)))
    )
      throw new AppError("Access key is incorrect", 401);
    const token = randomBytes(32).toString("base64url");
    await this.db.put("system", "sessions", {
      id: digest(token).toString("hex"),
      owner: "local-user",
      expiresAt: Date.now() + 24 * 60 * 60 * 1000,
    });
    return { token, mode: this.config.mode, owner: "local-user" };
  }
  async owner(authorization?: string) {
    if (!authorization?.startsWith("Bearer ")) throw new AppError("Sign in to OpenMuse", 401);
    const token = authorization.slice(7).trim();
    if (!token) throw new AppError("Sign in to OpenMuse", 401);

    if (this.config.authBackend === "rhodiz") {
      let response: Response;
      try {
        response = await fetch(`${this.config.rhodizApiUrl}/api/rhodiz/sesion`, {
          headers: { "x-rhodiz-token": token },
          signal: AbortSignal.timeout(5000),
        });
      } catch {
        throw new AppError("RHODIZ session validation is unavailable", 503);
      }
      if (!response.ok) throw new AppError("RHODIZ session expired. Sign in again.", 401);
      const payload = (await response.json()) as { user_id?: unknown };
      const owner = String(payload.user_id ?? "");
      if (!owner) throw new AppError("RHODIZ session is missing a stable identity", 401);
      return owner;
    }

    const session = await this.db.get<{ owner: string; expiresAt: number }>(
      "system",
      "sessions",
      digest(token).toString("hex"),
    );
    if (!session || session.expiresAt < Date.now())
      throw new AppError("Session expired. Sign in again.", 401);
    return session.owner;
  }
  sign(owner: string, path: string) {
    const expires = String(Date.now() + 15 * 60 * 1000);
    const signature = createHmac("sha256", this.signingKey)
      .update(`${owner}\n${path}\n${expires}`)
      .digest("hex");
    return `${this.config.publicUrl}${path}?owner=${encodeURIComponent(owner)}&expires=${expires}&signature=${signature}`;
  }
  verify(url: URL) {
    const owner = url.searchParams.get("owner") ?? "";
    const expires = url.searchParams.get("expires") ?? "";
    const signature = url.searchParams.get("signature") ?? "";
    if (
      !owner ||
      !/^\d+$/.test(expires) ||
      Number(expires) < Date.now() ||
      !/^\w{64}$/.test(signature)
    )
      throw new AppError("Document link expired; refresh the workspace", 401);
    const expected = createHmac("sha256", this.signingKey)
      .update(`${owner}\n${url.pathname}\n${expires}`)
      .digest("hex");
    if (!timingSafeEqual(Buffer.from(expected), Buffer.from(signature)))
      throw new AppError("Invalid access link", 403);
    return owner;
  }
}
export async function createAuth(db: Store, config: Config) {
  await mkdir(config.dataDir, { recursive: true, mode: 0o700 });
  const path = join(config.dataDir, "session-signing-key");
  let key: string;
  try {
    key = await readFile(path, "utf8");
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    key = randomBytes(32).toString("base64");
    await writeFile(path, key, { mode: 0o600, flag: "wx" });
  }
  return new Auth(db, config, key);
}
