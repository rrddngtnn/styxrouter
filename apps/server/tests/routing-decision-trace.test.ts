import { expect, test } from "bun:test";
import { clearRoutingTrace, recordRoutingTrace, readRoutingTrace } from "../src/sse/services/routingDecisionTrace.ts";

test("trace is bounded and never stores input strings", () => {
  clearRoutingTrace();
  for (let i = 0; i < 1100; i++) recordRoutingTrace({ kind: "selection", provider: "secret-provider", account: `secret-account-${i}`, reason: "rateLimited" });
  const events = readRoutingTrace();
  expect(events.length).toBe(1000);
  expect(events[0].reason).toBe("rateLimited");
  expect(JSON.stringify(events)).not.toContain("secret-");
});

test("real credential selection records cooldown skip and selected candidate", async () => {
  clearRoutingTrace();
  const { createProviderConnection } = await import("../src/lib/db/providers.ts");
  const { getProviderCredentials } = await import("../src/sse/services/auth.ts");
  const a = await createProviderConnection({ provider: "openai", authType: "apikey", apiKey: "secret-a", isActive: true, rateLimitedUntil: new Date(Date.now() + 60000).toISOString() } as any);
  const b = await createProviderConnection({ provider: "openai", authType: "apikey", apiKey: "secret-b", isActive: true } as any);
  const selected = await getProviderCredentials("openai", null, [a.id, b.id], "fixture-model");
  expect(selected?.connectionId).toBe(b.id);
  const events = readRoutingTrace();
  expect(events.map(e => e.reason)).toContain("rateLimited");
  expect(events.map(e => e.reason)).toContain("selected");
  expect(JSON.stringify(events)).not.toContain("secret-");
}, 60000);

test("management trace endpoint requires a dashboard session", async () => {
  const { Hono } = await import("hono");
  const { SignJWT } = await import("jose");
  const { requireAuth } = await import("../server/auth.ts");
  const { createRoutingTraceApi } = await import("../server/routingTrace.ts");
  const old = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "synthetic-test-jwt-secret";
  try {
    const app = new Hono();
    app.use("*", requireAuth);
    app.route("/api/routing/trace", createRoutingTraceApi());
    expect((await app.request("/api/routing/trace")).status).toBe(401);
    const token = await new SignJWT({}).setProtectedHeader({ alg: "HS256" }).sign(new TextEncoder().encode(process.env.JWT_SECRET));
    const response = await app.request("/api/routing/trace", { headers: { cookie: `auth_token=${token}` } });
    expect(response.status).toBe(200);
    expect(Array.isArray((await response.json() as any).events)).toBe(true);
    expect(response.headers.get("cache-control")).toBe("no-store");
  } finally { if (old === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = old; }
});
