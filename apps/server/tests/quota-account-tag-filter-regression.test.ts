import { expect, test } from "bun:test";
import { startTestServer } from "./helpers/start-test-server";
import { stopTestProcess } from "./helpers/stop-test-process";

test("quota inventory filters by normalized exact account tag and composes with provider", async () => {
  const server = await startTestServer(process.execPath, { cwd: `${import.meta.dir}/..`, env: { ...process.env, STYX_TEST_MODE: "1", JWT_SECRET: "fixture-jwt-secret-01234567890123456789", INITIAL_PASSWORD: "fixture-password", STORAGE_ENCRYPTION_KEY: "fixture-encryption-key" } });
  try {
    const login = await fetch(server.base + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "fixture-password" }) });
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    const post = (path: string, body: unknown) => fetch(server.base + path, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(body) });
    const ids: string[] = [];
    for (const [provider, name] of [["openai", "blue"], ["openai", "blueberry"], ["anthropic", "other-blue"]]) {
      const res = await post("/api/connections", { provider, name, apiKey: `fixture-${name}` });
      expect(res.status).toBe(201);
      ids.push((await res.json() as any).id);
    }
    expect((await post("/api/connections/bulk-tags", { ids: [ids[0], ids[2]], operation: "add", tags: ["Blue"] })).status).toBe(200);
    expect((await post("/api/connections/bulk-tags", { ids: [ids[1]], operation: "add", tags: ["blueberry"] })).status).toBe(200);
    const get = (query: string) => fetch(server.base + "/api/usage/quota" + query, { headers: { cookie } });
    expect((await fetch(server.base + "/api/usage/quota?tag=blue")).status).toBe(401);
    const filtered = await get("?tag=%20BLUE%20&provider=openai");
    expect(filtered.status).toBe(200);
    expect(((await filtered.json()) as any).providers.map((p: any) => p.connectionId)).toEqual([ids[0]]);
    expect(((await (await get("?tag=missing")).json()) as any).providers).toEqual([]);
    expect((await get("?tag=%20")).status).toBe(400);
    expect((await get("?tag=blue&tag=blueberry")).status).toBe(400);
    expect((await get(`?tag=${"x".repeat(65)}`)).status).toBe(400);
  } finally { await stopTestProcess(server.proc); }
}, 60000);
