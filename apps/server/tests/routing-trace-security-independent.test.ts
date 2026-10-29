import { expect, test } from "bun:test";
import { Hono } from "hono";
import { SignJWT } from "jose";
process.env.API_KEY_SECRET = "synthetic-trace-api-key-secret";
process.env.JWT_SECRET = "synthetic-trace-jwt-secret";
const { requireAuth } = await import("../server/auth.ts");
import { createRoutingTraceApi } from "../server/routingTrace.ts";
import { clearRoutingTrace, readRoutingTrace, recordRoutingTrace } from "../src/sse/services/routingDecisionTrace.ts";

test("management trace denies bearer and exposes only bounded pseudonyms to a session", async () => {
  const old = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "fixture-jwt-secret-for-independent-review";
  clearRoutingTrace();
  try {
    for (let i = 0; i < 1002; i++) recordRoutingTrace({ kind: "selection", provider: "provider-secret", account: `account-secret-${i}`, reason: "selected", cooldownMs: 1e20 });
    const app = new Hono();
    app.use("*", requireAuth);
    app.route("/api/routing/trace", createRoutingTraceApi());
    expect((await app.request("/api/routing/trace")).status).toBe(401);
    const { createApiKey } = await import("../src/lib/db/apiKeys.ts");
    const apiKey = await createApiKey("trace-security-review", "test");
    expect((await app.request("/api/routing/trace", { headers: { authorization: `Bearer ${apiKey.key}` } })).status).toBe(401);
    expect((await app.request("/api/routing/trace", { headers: { cookie: "auth_token=invalid" } })).status).toBe(401);
    const token = await new SignJWT({ authenticated: true }).setProtectedHeader({ alg: "HS256" }).setExpirationTime("1h").sign(new TextEncoder().encode(process.env.JWT_SECRET));
    const response = await app.request("/api/routing/trace", { headers: { cookie: `auth_token=${token}` } });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const text = await response.text();
    const events = JSON.parse(text).events;
    expect(events).toHaveLength(1000);
    expect(events[0].account).not.toBe(events[999].account);
    expect(events.every((e: any) => e.cooldownMs === 86400000 && /^[a-f0-9]{16}$/.test(e.account) && /^[a-f0-9]{16}$/.test(e.provider))).toBe(true);
    for (const secret of ["provider-secret", "account-secret", "fixture-api-key", token]) expect(text).not.toContain(secret);
    events[0].reason = "modified";
    expect(readRoutingTrace()[0].reason).toBe("selected");
  } finally {
    clearRoutingTrace();
    if (old === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = old;
  }
});

test("trace pseudonyms and buffers are process-local", () => {
  clearRoutingTrace();
  recordRoutingTrace({ kind: "selection", provider: "same-provider", account: "same-account", reason: "selected" });
  const parent = readRoutingTrace()[0];
  const code = `import {readRoutingTrace,recordRoutingTrace} from ${JSON.stringify(new URL("../src/sse/services/routingDecisionTrace.ts", import.meta.url).href)}; const before=readRoutingTrace().length; recordRoutingTrace({kind:'selection',provider:'same-provider',account:'same-account',reason:'selected'}); console.log(JSON.stringify({before,event:readRoutingTrace()[0]}));`;
  const child = Bun.spawnSync([process.execPath, "--no-env-file", "-e", code], { stdout: "pipe", stderr: "pipe" });
  expect(child.exitCode).toBe(0);
  const result = JSON.parse(child.stdout.toString());
  expect(result.before).toBe(0);
  expect(result.event.provider).not.toBe(parent.provider);
  expect(result.event.account).not.toBe(parent.account);
  clearRoutingTrace();
});
