// Serve upstream Next-style route modules ({ GET, POST, ... } taking (request, { params })) from Hono.
// Modules are imported on first use so they do not slow down or endanger boot.
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
