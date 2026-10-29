import { afterAll, expect, test } from "bun:test";
import { Hono } from "hono";
import { SignJWT } from "jose";
import { requireAuth } from "../server/auth";

const oldOrigin = process.env.STYX_TRUSTED_PUBLIC_ORIGIN;
const oldSecret = process.env.JWT_SECRET;
process.env.STYX_TRUSTED_PUBLIC_ORIGIN = "https://router.example";
process.env.JWT_SECRET = "independent-security-test-secret";
const token = await new SignJWT({ authenticated: true }).setProtectedHeader({ alg: "HS256" }).sign(new TextEncoder().encode(process.env.JWT_SECRET));
const app = new Hono();
app.use("*", requireAuth);
app.patch("/api/settings", c => c.text("ok"));
app.post("/api/providers", c => c.text("ok"));
afterAll(() => {
  if (oldOrigin === undefined) delete process.env.STYX_TRUSTED_PUBLIC_ORIGIN; else process.env.STYX_TRUSTED_PUBLIC_ORIGIN = oldOrigin;
  if (oldSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = oldSecret;
});

test("configured origin cannot be bypassed through loopback proxy without forwarding headers", async () => {
  for (const [path, method] of [["/api/settings", "PATCH"], ["/api/providers", "POST"]]) {
    const response = await app.fetch(new Request(`http://127.0.0.1:8080${path}`, { method, headers: { cookie: `auth_token=${token}`, host: "127.0.0.1:8080", origin: "http://127.0.0.1:8080" } }), { peerAddress: "127.0.0.1" });
    expect(response.status).toBe(403);
  }
});
