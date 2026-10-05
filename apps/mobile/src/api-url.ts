export function normalizeWebBasePath(value: string): string {
  const path = value.replace(/\/$/, "");
  if (!/^(?:\/[A-Za-z0-9_-]+)*$/.test(path))
    throw new Error("Web base path must be empty or an absolute path such as /muse");
  return path;
}

export function resolveApiUrl(options: {
  platform: string;
  configuredUrl?: string;
  webBasePath?: string;
  webOrigin?: string;
}): string {
  if (options.configuredUrl) return options.configuredUrl.replace(/\/$/, "");
  if (options.platform === "web" && options.webBasePath !== undefined) {
    const path = normalizeWebBasePath(options.webBasePath);
    if (!options.webOrigin) throw new Error("Web deployment requires a browser origin");
    const origin = new URL(options.webOrigin);
    if (!["http:", "https:"].includes(origin.protocol) || origin.username || origin.password)
      throw new Error("Web deployment requires an HTTP(S) browser origin");
    return `${origin.origin}${path}`;
  }
  return options.platform === "android" ? "http://10.0.2.2:8787" : "http://localhost:8787";
}
