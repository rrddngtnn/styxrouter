import "./helpers/test-secrets";
import { expect, test } from "bun:test";
import { clearAntigravityVersionCaches } from "../open-sse/services/antigravityVersion";
import { setAntigravityVersionPin } from "../src/lib/db/antigravityVersionPin";
import config from "../server/styx";

test("authenticated HTTP status reports independent observations, pins and effective versions without fetching", async () => {
  process.env.INITIAL_PASSWORD = "fixture-password";
  clearAntigravityVersionCaches();
  setAntigravityVersionPin("ide", null); setAntigravityVersionPin("cli", null);
  const server = Bun.serve({ ...config, hostname: "127.0.0.1", port: 0 });
  const base = `http://127.0.0.1:${server.port}`;
  const original = globalThis.fetch;
  let outbound = 0;
  let ide = "9.0.0", cli = "8.0.0", fail = false;
  globalThis.fetch = (async (input, init) => {
    if (String(input).startsWith(base)) return original(input, init);
    if (!String(input).includes("antigravity-auto-updater") && !String(input).includes("antigravity-cli-auto-updater")) return new Response("blocked", { status: 503 });
    outbound++;
    if (fail) return new Response("failed", { status: 503 });
    return String(input).includes("antigravity-cli-auto-updater") ? Response.json({ version: cli }) : Response.json([{ version: ide }]);
  }) as typeof fetch;
  try {
    for (const product of ["ide", "cli"]) {
      expect((await fetch(`${base}/api/versions/antigravity/${product}/status`)).status).toBe(401);
    }
    const login = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "fixture-password" }) });
    expect(login.status).toBe(200);
    const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
    const status = async (product: string) => fetch(`${base}/api/versions/antigravity/${product}/status`, { headers: { cookie } });
    const initial = await status("ide");
    expect(initial.status).toBe(200); expect(initial.headers.get("cache-control")).toBe("no-store");
    expect(await initial.json()).toMatchObject({ observedVersion: null, observedAt: null, pinnedVersion: null, effectiveVersion: "2.1.1" });
    expect(outbound).toBe(0);
    const refresh = () => fetch(`${base}/api/versions/antigravity/refresh`, { method: "POST", headers: { cookie } });
    expect((await refresh()).status).toBe(200);
    ide = "7.0.0"; cli = "6.0.0";
    expect((await refresh()).status).toBe(200);
    const a = await (await status("ide")).json(); const b = await (await status("cli")).json();
    expect(a).toMatchObject({ observedVersion: "7.0.0", cachedVersion: "9.0.0", effectiveVersion: "9.0.0", pinnedVersion: null });
    expect(b).toMatchObject({ observedVersion: "6.0.0", cachedVersion: "8.0.0", effectiveVersion: "8.0.0", pinnedVersion: null });
    expect(a.observedAt).toBeGreaterThan(0); expect(b.observedAt).toBeGreaterThan(0);
    fail = true; expect((await refresh()).status).toBe(502);
    expect((await (await status("cli")).json()).observedAt).toBe(b.observedAt);
    const pin = await fetch(`${base}/api/versions/antigravity/cli/pin`, { method: "PUT", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ version: "3.0.0" }) });
    expect(pin.status).toBe(200);
    expect(await (await status("cli")).json()).toMatchObject({ pinnedVersion: "3.0.0", effectiveVersion: "3.0.0", observedVersion: "6.0.0" });
    expect((await status("hub")).status).toBe(404);
    expect(outbound).toBe(6);
  } finally {
    globalThis.fetch = original; server.stop(true); clearAntigravityVersionCaches();
    setAntigravityVersionPin("ide", null); setAntigravityVersionPin("cli", null);
  }
}, 60000);
