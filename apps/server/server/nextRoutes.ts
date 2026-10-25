// Serve upstream Next-style route modules ({ GET, POST, ... } taking (request, { params })) from Hono.
// Modules are imported on first use so they do not slow down or endanger boot.
import { readdirSync } from "node:fs";
import { join } from "node:path";
import type { Hono } from "hono";

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

export function mountNextRoute(app: Hono, path: string, load: () => Promise<Record<string, any>>, methods: readonly string[] = METHODS) {
  for (const method of methods) {
    app.on(method, path, async (c) => {
      const handler = (await load())[method];
      if (typeof handler !== "function") return c.json({ error: "Method not allowed" }, 405);
      return handler(c.req.raw, { params: Promise.resolve(c.req.param()) });
    });
  }
}

/**
 * Mount every `route.ts` under `root/<prefix>` for the allow-listed prefixes. Folder names in [brackets] become :params
 * (catch-all [...x] folders are skipped). Static paths are registered before parameterised ones so that
 * /usage/budget is not swallowed by /usage/:connectionId.
 */
export function mountNextTree(app: Hono, root: string, prefixes: readonly string[]) {
  const found: { path: string; file: string }[] = [];
  const walk = (dir: string, segments: string[]) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (entry.name.startsWith("[...")) continue;
        const seg = entry.name.startsWith("[") ? `:${entry.name.slice(1, -1)}` : entry.name;
        walk(join(dir, entry.name), [...segments, seg]);
      } else if (entry.name === "route.ts") {
        found.push({ path: `/${segments.join("/")}`, file: join(dir, entry.name) });
      }
    }
  };
  for (const prefix of prefixes) {
    const segs = prefix.split("/");
    try {
      walk(join(root, ...segs), segs);
    } catch {
      // a prefix that does not exist in this build is simply not mounted
    }
  }
  const dynamism = (p: string) => (p.match(/:/g) ?? []).length;
  found.sort((a, b) => dynamism(a.path) - dynamism(b.path) || a.path.localeCompare(b.path));
  for (const { path, file } of found) mountNextRoute(app, path, () => import(file));
}
