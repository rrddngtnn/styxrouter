import { expect, test } from "bun:test";
import { startTestServer } from "./helpers/start-test-server";
import { Database } from "bun:sqlite";
import { join } from "node:path";

test("provider node prefix creation and rename are atomic across servers and preserve legacy duplicates", async () => {
  const opts = { cwd: join(import.meta.dir, ".."), env: { ...process.env, STYX_TEST_MODE: "1", JWT_SECRET: "fixture-node-jwt-secret-0123456789", API_KEY_SECRET: "fixture-node-key-secret-0123456789", INITIAL_PASSWORD: "fixture-node-password" } };
  const a = await startTestServer(process.execPath, opts);
  const b = await startTestServer(process.execPath, opts);
  try {
    const login = await fetch(a.base + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "fixture-node-password" }) });
    const cookie = (login.headers.get("set-cookie") || "").split(";")[0];
    const call = (base: string, method: string, path: string, body: any) => fetch(base + path, { method, headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(body) });
    const node = (prefix: string) => ({ type: "openai-compatible", name: prefix, prefix, apiType: "chat", baseUrl: "https://example.test" });
    const race = await Promise.all([call(a.base, "POST", "/api/provider-nodes", node("raceprefix")), call(b.base, "POST", "/api/provider-nodes", node("raceprefix"))]);
    expect(race.map(r => r.status).sort()).toEqual([201, 409]);
    const one: any = await (await call(a.base, "POST", "/api/provider-nodes", node("firstprefix"))).json();
    const two: any = await (await call(a.base, "POST", "/api/provider-nodes", node("secondprefix"))).json();
    expect((await call(b.base, "PATCH", `/api/provider-nodes/${two.node.id}`, { prefix: "firstprefix" })).status).toBe(409);
    const db = new Database(join(process.env.DATA_DIR!, "storage.sqlite"));
    db.query("UPDATE provider_nodes SET prefix = ? WHERE id = ?").run("firstprefix", two.node.id);
    db.close();
    expect((await call(a.base, "PATCH", `/api/provider-nodes/${one.node.id}`, { name: "still editable" })).status).toBe(200);
    expect((await call(a.base, "PATCH", `/api/provider-nodes/${one.node.id}`, { prefix: "firstprefix" })).status).toBe(200);
    expect((await call(a.base, "PATCH", `/api/provider-nodes/${two.node.id}`, { prefix: "fixedprefix" })).status).toBe(200);
    const listed: any = await (await fetch(a.base + "/api/provider-nodes", { headers: { cookie } })).json();
    expect(listed.nodes.find((n: any) => n.id === one.node.id).prefix).toBe("firstprefix");
    expect(listed.nodes.find((n: any) => n.id === two.node.id).prefix).toBe("fixedprefix");
  } finally { for (const s of [a, b]) if (s.proc.exitCode === null) { const done = new Promise(resolve => s.proc.once("exit", resolve)); s.proc.kill("SIGKILL"); await done; } }
}, 60000);
