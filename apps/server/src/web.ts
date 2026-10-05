import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import { serveStatic } from "@hono/node-server/serve-static";
import type { MiddlewareHandler } from "hono";

function contains(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path === "" || (!isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`));
}

export async function createWebMiddleware(
  directory: string,
  dataDirectory: string,
  publicUrl?: string,
): Promise<MiddlewareHandler> {
  const [root, data] = await Promise.all([realpath(directory), realpath(dataDirectory)]);
  if (contains(root, data) || contains(data, root))
    throw new Error("Exported web files and writable data must use separate directories");
  if (!(await stat(join(root, "index.html"))).isFile())
    throw new Error("The web export must contain index.html");
  if (publicUrl !== undefined) {
    const manifest = JSON.parse(await readFile(join(root, "rhodiz-web.json"), "utf8"));
    const expected = new URL(publicUrl).pathname.replace(/\/$/, "");
    if (manifest?.version !== 1 || manifest.basePath !== expected)
      throw new Error("PUBLIC_API_URL path does not match the built web artifact");
  }
  const serve = serveStatic({ root });
  return async (c, next) => {
    if (!["GET", "HEAD"].includes(c.req.method)) return next();
    // Never turn an API failure into a successful HTML response.
    if (c.req.path === "/api" || c.req.path.startsWith("/api/")) return next();
    let path: string;
    try {
      path = decodeURIComponent(c.req.path);
    } catch {
      return c.notFound();
    }
    if (path.split("/").some((part) => part.startsWith(".")) || path.endsWith(".map"))
      return c.notFound();
    return serve(c, next);
  };
}
