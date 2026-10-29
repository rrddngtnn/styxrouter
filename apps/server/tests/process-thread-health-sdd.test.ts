import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Hono } from "hono";
import { createProcessHealthApi } from "../server/processHealth.ts";
import { requireAuth } from "../server/auth.ts";

test("thread health exposes only the current process thread count without caching", async () => {
  const app = new Hono();
  app.route("/api/process-health", createProcessHealthApi());
  const response = await app.request("/api/process-health/threads");
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const body = await response.json() as { threadCount: number | null };
  expect(Object.keys(body)).toEqual(["threadCount"]);
  if (process.platform === "linux") {
    const expected = Number(readFileSync("/proc/self/status", "utf8").match(/^Threads:\s+(\d+)\s*$/m)![1]);
    expect(body.threadCount).toBe(expected);
    expect(body.threadCount).toBeGreaterThan(0);
  } else {
    expect(body.threadCount).toBeNull();
  }
});

test("thread health requires a management session", async () => {
  const app = new Hono();
  app.use("*", requireAuth);
  app.route("/api/process-health", createProcessHealthApi());
  expect((await app.request("/api/process-health/threads")).status).toBe(401);
});
