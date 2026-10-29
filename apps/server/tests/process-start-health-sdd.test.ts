import { expect, test } from "bun:test";
import { Hono } from "hono";
import { createProcessHealthApi } from "../server/processHealth.ts";
import { requireAuth } from "../server/auth.ts";

test("process start endpoint reports a stable, plausible process start time", async () => {
  const app = new Hono();
  app.route("/api/process-health", createProcessHealthApi());
  const first = await app.request("/api/process-health/start");
  expect(first.status).toBe(200);
  expect(first.headers.get("cache-control")).toBe("no-store");
  const body = await first.json() as { startedAt: string };
  expect(Object.keys(body)).toEqual(["startedAt"]);
  const started = Date.parse(body.startedAt);
  expect(Number.isFinite(started)).toBe(true);
  expect(Math.abs(started - (Date.now() - process.uptime() * 1000))).toBeLessThan(2000);
  const second = await (await app.request("/api/process-health/start")).json();
  expect(second).toEqual(body);
});

test("process start endpoint requires a management session", async () => {
  const app = new Hono();
  app.use("*", requireAuth);
  app.route("/api/process-health", createProcessHealthApi());
  expect((await app.request("/api/process-health/start")).status).toBe(401);
});
