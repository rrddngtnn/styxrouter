import { expect, test } from "bun:test";
import config from "../server/styx";
import { clearAntigravityVersionCaches } from "../open-sse/services/antigravityVersion";

test("status is authenticated, no-store, passive, and follows each product pin and retained observation over real HTTP", async () => {
  clearAntigravityVersionCaches();
  const server = Bun.serve({ ...config, hostname: "127.0.0.1", port: 0 });
  const base = `http://127.0.0.1:${server.port}`;
  const original = globalThis.fetch;
  const outgoing: string[] = [];
  let failCli = false;
  globalThis.fetch = (async (url, init) => {
    const s = String(url);
    if (s.startsWith(base + "/")) return original(url, init);
    outgoing.push(s);
    if (s.includes("antigravity-cli-auto-updater")) return failCli ? new Response("unavailable", { status: 503 }) : Response.json({ version: "7.6.5" });
    if (s.includes("antigravity-auto-updater")) return Response.json([{ version: "8.7.6" }]);
    return new Response("blocked", { status: 503 });
  }) as typeof fetch;
  try {
    for (const p of ["ide", "cli"]) expect((await fetch(`${base}/api/versions/antigravity/${p}/status`)).status).toBe(401);
    const login = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "fixture-password" }) });
    expect(login.status).toBe(200);
    const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
    const request = (path: string, init: RequestInit = {}) => fetch(base + path, { ...init, headers: { cookie, ...(init.headers || {}) } });
    const status = async (p: string) => {
      const r = await request(`/api/versions/antigravity/${p}/status`);
      expect(r.status).toBe(200); expect(r.headers.get("cache-control")).toBe("no-store");
      return r.json();
    };
    const setPin = (p: string, version: string | null) => request(`/api/versions/antigravity/${p}/pin`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ version }) });
    for (const p of ["ide", "cli"]) { expect((await setPin(p, null)).status).toBe(200); }
    const count = outgoing.length;
    expect(await status("ide")).toMatchObject({ observedVersion: null, observedAt: null, pinnedVersion: null, cachedVersion: "2.1.1", effectiveVersion: "2.1.1" });
    expect(await status("cli")).toMatchObject({ observedVersion: null, observedAt: null, pinnedVersion: null, cachedVersion: "1.1.5", effectiveVersion: "1.1.5" });
    expect(outgoing.length).toBe(count);
    expect((await request("/api/versions/antigravity/refresh", { method: "POST" })).status).toBe(200);
    for (const [p, version, pin] of [["ide", "8.7.6", "3.2.1"], ["cli", "7.6.5", "4.3.2"]]) {
      const observed = await status(p!);
      expect(observed).toMatchObject({ observedVersion: version, cachedVersion: version, effectiveVersion: version, pinnedVersion: null });
      expect(observed.observedAt).toBeGreaterThan(0);
      expect((await setPin(p!, pin!)).status).toBe(200);
      expect(await status(p!)).toMatchObject({ observedVersion: version, cachedVersion: version, effectiveVersion: pin, pinnedVersion: pin });
      expect((await setPin(p!, null)).status).toBe(200);
      expect(await status(p!)).toMatchObject({ observedVersion: version, cachedVersion: version, effectiveVersion: version, pinnedVersion: null });
    }
    const before = await status("cli"); failCli = true;
    expect((await request("/api/versions/antigravity/refresh", { method: "POST" })).status).toBe(502);
    expect(await status("cli")).toEqual(before);
    const afterRefresh = outgoing.length;
    await status("ide"); await status("cli");
    expect(outgoing.length).toBe(afterRefresh);
  } finally { globalThis.fetch = original; server.stop(true); clearAntigravityVersionCaches(); }
}, 60000);
