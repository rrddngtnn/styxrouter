import { expect, mock, test } from "bun:test";

mock.module("@/shared/utils/testProcess", () => ({ isAutomatedTestProcess: () => false }));
const { getDbInstance } = await import("../src/lib/db/core");
const { deleteProviderConnections } = await import("../src/lib/db/providers/deletion");

test("bulk deletion preserves requested connections inserted while backup is pending", async () => {
  const db = getDbInstance();
  db.prepare("INSERT OR REPLACE INTO key_value (namespace, key, value) VALUES (?, ?, ?)")
    .run("databaseSettings", "autoBackupEnabled", "true");
  const insert = db.prepare("INSERT INTO provider_connections (id, provider, auth_type, created_at, updated_at) VALUES (?, ?, ?, ?, ?)");
  const now = new Date().toISOString();
  insert.run("bulk-old", "bulk-race", "apikey", now, now);
  const original = db.backup;
  let release!: () => void;
  let started!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const backupStarted = new Promise<void>(resolve => { started = resolve; });
  db.backup = async destination => { started(); await gate; await original(destination); };
  try {
    const deleting = deleteProviderConnections(["bulk-old", "bulk-new"]);
    await Promise.race([backupStarted, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("backup did not start")), 1000))]);
    insert.run("bulk-new", "bulk-race", "apikey", now, now);
    db.prepare("INSERT INTO quota_snapshots (provider, connection_id, window_key) VALUES (?, ?, ?)")
      .run("bulk-race", "bulk-new", "daily");
    release();
    expect(await deleting).toBe(1);
    expect(db.prepare("SELECT id FROM provider_connections WHERE id = ?").get("bulk-old")).toBeFalsy();
    expect(db.prepare("SELECT id FROM provider_connections WHERE id = ?").get("bulk-new")).toBeTruthy();
    expect(db.prepare("SELECT id FROM quota_snapshots WHERE connection_id = ?").get("bulk-new")).toBeTruthy();
  } finally { release(); db.backup = original; }
});
