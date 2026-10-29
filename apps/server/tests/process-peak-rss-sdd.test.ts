import { expect, test } from "bun:test";
import { Hono } from "hono";
import { createProcessHealthApi } from "../server/processHealth";

test("health reports the OS high-water RSS for this process without caching", async () => {
  const app = new Hono();
  app.route("/health", createProcessHealthApi());
  const before = process.resourceUsage().maxRSS * 1024;
  const response = await app.request("/health/peak");
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const body = await response.json() as { peakRssBytes: number | null };
  if (process.platform === "linux") {
    expect(body.peakRssBytes).toBeGreaterThanOrEqual(before);
    expect(body.peakRssBytes).toBeLessThanOrEqual(process.resourceUsage().maxRSS * 1024);
  } else {
    expect(body.peakRssBytes).toBeNull();
  }
});
