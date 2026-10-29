import { Hono } from "hono";
import { SignJWT } from "jose";

declare const Bun: { serve(options: { hostname: string; port: number; fetch: typeof app.fetch }): { port: number } };

// Set fixture secrets before importing auth or any DB-dependent modules.
process.env.API_KEY_SECRET = "synthetic-scope-api-key-secret";
process.env.JWT_SECRET = "synthetic-scope-jwt-secret";
process.env.INITIAL_PASSWORD = "synthetic-scope-password";
const { requireAuth } = await import("../../server/auth.ts");
const { createRoutingTraceApi } = await import("../../server/routingTrace.ts");
const { recordRoutingTrace } = await import("../../src/sse/services/routingDecisionTrace.ts");
const token = await new SignJWT({}).setProtectedHeader({ alg: "HS256" }).sign(new TextEncoder().encode(process.env.JWT_SECRET));
const app = new Hono();
app.use("/api/*", requireAuth);
app.route("/api/routing/trace", createRoutingTraceApi());
// This fixture-only route permits deterministic changes in the worker's buffer.
app.post("/fixture/record", (c) => {
  recordRoutingTrace({ kind: "selection", provider: "fixture-provider-secret", account: "fixture-account-secret", reason: "selected" });
  return c.json({ ok: true });
});
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: app.fetch });
console.log(JSON.stringify({ port: server.port, token }));
