import { expect, test } from "bun:test";
import { getDbInstance } from "../src/lib/db/core";
import { createProviderConnection } from "../src/lib/db/providers";
import { createPool } from "../src/lib/db/quotaPools";

test("database rejects the reserved deny marker as a quota pool id on insert and update", async () => {
  const conn = await createProviderConnection({ provider: "openai", authType: "apikey", apiKey: "a", name: "reserved" } as any);
  const pool = createPool({ connectionId: conn.id, name: "reserved" });
  const db = getDbInstance();
  expect(() => db.prepare("UPDATE quota_pools SET id = ? WHERE id = ?").run("__quota_access_revoked__", pool.id)).toThrow();
  expect(() => db.prepare("INSERT INTO quota_pools (id, connection_id, name, created_at) VALUES (?, ?, ?, ?)").run("__quota_access_revoked__", conn.id, "reserved", new Date().toISOString())).toThrow();
});
