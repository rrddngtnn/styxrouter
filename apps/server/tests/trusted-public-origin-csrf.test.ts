import { afterAll, expect, test } from "bun:test";
import { Hono } from "hono";
import { SignJWT } from "jose";
import { requireAuth } from "../server/auth";

const originalOrigin = process.env.STYX_TRUSTED_PUBLIC_ORIGIN;
const originalSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = "csrf-test-secret";
const token = await new SignJWT({ authenticated: true }).setProtectedHeader({ alg: "HS256" }).sign(new TextEncoder().encode(process.env.JWT_SECRET));
const app = new Hono();
app.use("*", requireAuth);
app.patch("/api/settings", c => c.text("ok"));
async function request(origin: string | undefined, host = "internal:8080", extra: Record<string, string> = {}, peerAddress = "192.0.2.10") {
  return app.fetch(new Request("http://internal:8080/api/settings", { method: "PATCH", headers: { cookie: `auth_token=${token}`, host, ...(origin === undefined ? {} : { origin }), ...extra } }), { peerAddress });
}
afterAll(() => { if (originalOrigin === undefined) delete process.env.STYX_TRUSTED_PUBLIC_ORIGIN; else process.env.STYX_TRUSTED_PUBLIC_ORIGIN = originalOrigin; if (originalSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = originalSecret; });

test("configured public HTTPS origin is exact even when Host is rewritten", async () => {
  process.env.STYX_TRUSTED_PUBLIC_ORIGIN = "https://router.example";
  expect((await request("https://router.example")).status).toBe(200);
  expect((await request("http://router.example", "router.example", { "x-forwarded-proto": "https" })).status).toBe(403);
  expect((await request("https://evil.example", "internal:8080", { "x-forwarded-host": "evil.example", "x-forwarded-proto": "https" })).status).toBe(403);
});

test("invalid configuration fails closed including requests without Origin", async () => {
  for (const invalid of ["", "http://router.example", "https://router.example/", "https://user@router.example", "https://router.example/path", "https://router.example?x=1", "https://router.example#x", "https://*.example", "https://router.example:443"]) {
    process.env.STYX_TRUSTED_PUBLIC_ORIGIN = invalid;
    expect((await request(undefined)).status).toBe(403);
    expect((await request("https://router.example", "router.example")).status).toBe(403);
  }
});

test("configured origin rejects loopback origins even for loopback peers", async () => {
  process.env.STYX_TRUSTED_PUBLIC_ORIGIN = "https://router.example";
  expect((await request("http://127.0.0.1:8080", "127.0.0.1:8080", {}, "127.0.0.1")).status).toBe(403);
  expect((await request("http://localhost:8080", "localhost:8080", {}, "::1")).status).toBe(403);
  expect((await request("http://127.0.0.1:8080", "127.0.0.1:8080")).status).toBe(403);
  expect((await request("http://127.0.0.1:8080", "localhost:8080", {}, "127.0.0.1")).status).toBe(403);
  expect((await request("http://127.0.0.1:8080", "127.0.0.1:8080", { "x-forwarded-for": "192.0.2.1" }, "127.0.0.1")).status).toBe(403);
});

test("unset configuration retains host-only compatibility and absent origin support", async () => {
  delete process.env.STYX_TRUSTED_PUBLIC_ORIGIN;
  expect((await request("http://router.example", "router.example")).status).toBe(200);
  expect((await request(undefined)).status).toBe(200);
  expect((await request("https://evil.example", "router.example")).status).toBe(403);
});
