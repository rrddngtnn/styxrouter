import { expect, test } from "bun:test";
import { Hono } from "hono";
import { createProcessHealthApi } from "../server/processHealth.ts";
import { requireAuth } from "../server/auth.ts";

test("process health reports real process memory and uptime without sensitive environment data", async () => {
  const app = new Hono();
  app.route("/api/process-health", createProcessHealthApi());
  const response = await app.request("/api/process-health");
  expect(response.status).toBe(200);
  const body = await response.json() as any;
  expect(Number.isFinite(body.uptimeSeconds)).toBe(true);
  expect(body.uptimeSeconds).toBeGreaterThanOrEqual(0);
  expect(Object.keys(body).sort()).toEqual(["memory", "uptimeSeconds"]);
  expect(Object.keys(body.memory).sort()).toEqual(["heapTotalBytes", "heapUsedBytes", "rssBytes"]);
  // Bun can report heapUsed greater than heapTotal; validate each measurement independently.
  for (const bytes of Object.values(body.memory)) {
    expect(Number.isSafeInteger(bytes)).toBe(true);
    expect(bytes as number).toBeGreaterThan(0);
  }
});

test("process health requires a management session", async () => {
  const app = new Hono();
  app.use("*", requireAuth);
  app.route("/api/process-health", createProcessHealthApi());
  expect((await app.request("/api/process-health")).status).toBe(401);
});
