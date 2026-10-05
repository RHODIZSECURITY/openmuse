import { Platform } from "react-native";

import { resolveApiUrl } from "./api-url";

export const API_URL = resolveApiUrl({
  platform: Platform.OS,
  configuredUrl: process.env.EXPO_PUBLIC_API_URL,
  webBasePath: process.env.EXPO_PUBLIC_WEB_BASE_PATH,
  webOrigin: typeof window === "undefined" ? undefined : window.location?.origin,
});

export class MuseApi {
  constructor(readonly token: string) {}
  async request<T>(path: string, body?: unknown, method?: string): Promise<T> {
    const response = await fetch(`${API_URL}${path}`, {
      method: method ?? (body === undefined ? "GET" : "POST"),
      headers: {
        Authorization: `Bearer ${this.token}`,
        ...(body === undefined || body instanceof FormData
          ? {}
          : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
    });
    const payload = await response.json();
    if (!response.ok)
      throw new Error(
        typeof payload.error === "string" ? payload.error : `Request failed (${response.status})`,
      );
    return payload;
  }
  url(path: string) {
    return path.startsWith("http") ? path : `${API_URL}${path}`;
  }
}

export type SessionCredentials = {
  accessKey?: string;
  usuario?: string;
  password?: string;
  dispositivo?: string;
};

export async function serverInfo(): Promise<{
  mode: "sample" | "live";
  authBackend: "local" | "rhodiz";
}> {
  const response = await fetch(`${API_URL}/api/health`);
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Could not reach the OpenMuse server.");
  return payload;
}

export async function createSession(
  credentials: SessionCredentials = {},
): Promise<{ token: string; mode: "sample" | "live" }> {
  const response = await fetch(`${API_URL}/api/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(credentials),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Could not open your workspace.");
  return payload;
}
