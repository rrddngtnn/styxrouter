import { expect, test } from "bun:test";
import { startTestServer } from "./helpers/start-test-server";
import { stopTestProcess } from "./helpers/stop-test-process";

test("authenticated account inventory can filter by normalized exact tag", async () => {
  const server = await startTestServer(process.execPath, { cwd: `${import.meta.dir}/..`, env: { ...process.env, STYX_TEST_MODE: "1", JWT_SECRET: "fixture-jwt-secret-01234567890123456789", INITIAL_PASSWORD: "fixture-password", STORAGE_ENCRYPTION_KEY: "fixture-encryption-key" } });
  try {
    const login = await fetch(server.base + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "fixture-password" }) });
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    const post = (path: string, body: unknown) => fetch(server.base + path, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(body) });
    const ids: string[] = [];
    for (const name of ["one", "two", "untagged"]) {
      const response = await post("/api/connections", { provider: "openai", name, apiKey: "fixture-key-" + name });
      expect(response.status).toBe(201);
      ids.push((await response.json() as any).id);
    }
    await post("/api/connections/bulk-tags", { ids: [ids[0]], operation: "add", tags: ["Blue"] });
    await post("/api/connections/bulk-tags", { ids: [ids[1]], operation: "add", tags: ["blueberry"] });
    expect((await fetch(server.base + "/api/connections?tag=blue")).status).toBe(401);
    const get = async (query: string) => (await (await fetch(server.base + "/api/connections" + query, { headers: { cookie } })).json() as any).connections.map((c: any) => c.id);
    expect(await get("?tag=%20BLUE%20")).toEqual([ids[0]]);
    expect(await get("?tag=missing")).toEqual([]);
    expect(new Set(await get(""))).toEqual(new Set(ids));
    expect((await fetch(server.base + "/api/connections?tag=%20", { headers: { cookie } })).status).toBe(400);
    expect((await fetch(server.base + "/api/connections?tag=blue&tag=blueberry", { headers: { cookie } })).status).toBe(400);
  } finally { await stopTestProcess(server.proc); }
}, 60000);
