import { test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { startTestServer } from "./helpers/start-test-server";
import { stopTestProcess } from "./helpers/stop-test-process";
import { getConnectionRoutingTags, matchesRoutingTags } from "../src/domain/tagRouter";

test("account tag mutations are authenticated, audited, preserve metadata and drive routing", async () => {
  const { proc, base } = await startTestServer(process.execPath, { cwd: `${import.meta.dir}/..`, env: { ...process.env, STYX_TEST_MODE: "1", JWT_SECRET: "fixture-jwt-secret-01234567890123456789", INITIAL_PASSWORD: "fixture-password", STORAGE_ENCRYPTION_KEY: "fixture-encryption-key" } });
  try {
    const login = await fetch(base + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "fixture-password" }) });
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    const post = (path: string, body: unknown, headers: Record<string,string> = {}) => fetch(base + path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
    const created = await post("/api/connections", { provider: "openai", name: "Original", apiKey: "fixture-secret-key" }, { cookie });
    expect(created.status).toBe(201);
    const { id } = await created.json() as any;
    const db = new Database(`${process.env.STYX_DATA_DIR}/storage.sqlite`);
    try {
      db.query("UPDATE provider_connections SET provider_specific_data = ? WHERE id = ?").run(JSON.stringify({ nested: { secret: "metadata-secret" }, tags: ["old"] }), id);
      const request = { ids: [id], operation: "add", tags: [" Blue "] };
      expect((await post("/api/connections/bulk-tags", request)).status).toBe(401);
      expect((await post("/api/connections/bulk-tags", request, { cookie, origin: "https://evil.example" })).status).toBe(403);
      for (const tags of [[""], ["x".repeat(65)], Array.from({length:51}, (_,i) => String(i))]) expect((await post("/api/connections/bulk-tags", { ...request, tags }, { cookie })).status).toBe(400);
      db.exec("CREATE TRIGGER reject_tags BEFORE INSERT ON audit_log WHEN NEW.action = 'connection.tags' BEGIN SELECT RAISE(ABORT, 'denied'); END");
      const failed = await post("/api/connections/bulk-tags", request, { cookie });
      expect((await failed.json() as any).results[0].success).toBe(false);
      expect(JSON.parse((db.query("SELECT provider_specific_data FROM provider_connections WHERE id = ?").get(id) as any).provider_specific_data).tags).toEqual(["old"]);
      db.exec("DROP TRIGGER reject_tags");
      const response = await post("/api/connections/bulk-tags", request, { cookie });
      const text = await response.text();
      expect(text).not.toContain("secret");
      expect(JSON.parse(text).results[0].success).toBe(true);
      const data = JSON.parse((db.query("SELECT provider_specific_data FROM provider_connections WHERE id = ?").get(id) as any).provider_specific_data);
      expect(data.nested).toEqual({ secret: "metadata-secret" });
      expect(matchesRoutingTags(getConnectionRoutingTags(data), ["blue"], "all")).toBe(true);
      const listText = await (await fetch(base + "/api/connections", { headers: { cookie } })).text();
      expect(listText).not.toContain("metadata-secret");
      expect(JSON.parse(listText).connections.find((row: any) => row.id === id).tags).toContain("blue");
      const audits = db.query("SELECT details, metadata FROM audit_log WHERE action = 'connection.tags' AND target = ?").all(id);
      expect(audits).toHaveLength(1);
      expect(JSON.stringify(audits)).not.toContain("secret");
      const removed = await post("/api/connections/bulk-tags", { ids: [id], operation: "remove", tags: ["OLD"] }, { cookie });
      expect((await removed.json() as any).results[0].tags).toEqual(["blue"]);
      const replaced = await post("/api/connections/bulk-tags", { ids: [id, "missing"], operation: "replace", tags: ["New", "new"] }, { cookie });
      const outcomes = (await replaced.json() as any).results;
      expect(outcomes[0].tags).toEqual(["new"]);
      expect(outcomes[1].success).toBe(false);
    } finally { db.close(); }
  } finally { await stopTestProcess(proc); }
}, 60000);

test("two servers preserve concurrent tag additions and unrelated metadata", async () => {
  const options = { cwd: `${import.meta.dir}/..`, env: { ...process.env, STYX_TEST_MODE: "1", JWT_SECRET: "fixture-jwt-secret-01234567890123456789", INITIAL_PASSWORD: "fixture-password", STORAGE_ENCRYPTION_KEY: "fixture-encryption-key" } };
  const first = await startTestServer(process.execPath, options);
  let second: Awaited<ReturnType<typeof startTestServer>> | undefined;
  try {
    second = await startTestServer(process.execPath, options);
    const login = await fetch(first.base + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "fixture-password" }) });
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    const post = (base: string, path: string, body: unknown) => fetch(base + path, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) });
    const created = await post(first.base, "/api/connections", { provider: "openai", name: "race", apiKey: "fixture-race-key" });
    const { id } = await created.json() as any;
    const db = new Database(`${process.env.STYX_DATA_DIR}/storage.sqlite`);
    try {
      db.query("UPDATE provider_connections SET provider_specific_data = ? WHERE id = ?").run(JSON.stringify({ unrelated: { value: 3 } }), id);
      const requests = Array.from({length: 20}, (_, i) => post(i % 2 ? first.base : second!.base, "/api/connections/bulk-tags", { ids: [id], operation: "add", tags: [`tag${i}`] }));
      for (const response of await Promise.all(requests)) expect((await response.json() as any).results[0].success).toBe(true);
      const data = JSON.parse((db.query("SELECT provider_specific_data FROM provider_connections WHERE id = ?").get(id) as any).provider_specific_data);
      expect(data.unrelated).toEqual({ value: 3 });
      expect(new Set(data.tags)).toEqual(new Set(Array.from({length: 20}, (_, i) => `tag${i}`)));
      expect(db.query("SELECT count(*) AS n FROM audit_log WHERE action = 'connection.tags' AND target = ?").get(id)).toEqual({ n: 20 });
    } finally { db.close(); }
  } finally { if (second) await stopTestProcess(second.proc); await stopTestProcess(first.proc); }
}, 90000);
