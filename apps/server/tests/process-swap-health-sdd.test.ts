import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { Hono } from "hono";
import { createProcessHealthApi } from "../server/processHealth";

test("swap reports this process's Linux VmSwap without caching or host-wide data", async () => {
  const app = new Hono();
  app.route("/health", createProcessHealthApi());
  const response = await app.request("/health/swap");
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const body = await response.json() as { swapBytes: number | null };
  expect(Object.keys(body)).toEqual(["swapBytes"]);
  if (process.platform === "linux") {
    const status = await readFile("/proc/self/status", "utf8");
    const match = /^VmSwap:\s+(\d+)\s+kB\s*$/m.exec(status);
    if (match && body.swapBytes !== null) {
      expect(Number.isSafeInteger(body.swapBytes)).toBe(true);
      expect(body.swapBytes).toBeGreaterThanOrEqual(0);
    } else expect(body.swapBytes).toBeNull();
  } else expect(body.swapBytes).toBeNull();
});
