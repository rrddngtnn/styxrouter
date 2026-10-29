import { expect, test, mock } from "bun:test";
import { Database } from "bun:sqlite";
import { join } from "node:path";

mock.module("@/shared/utils/testProcess", () => ({ isAutomatedTestProcess: () => false }));
const { getDbInstance, DB_BACKUPS_DIR } = await import("../src/lib/db/core");
const { deleteProviderConnection, deleteProviderConnectionsByProvider } = await import("../src/lib/db/providers/deletion");
const { deleteApiKey } = await import("../src/lib/db/apiKeys");
const { readdirSync } = await import("node:fs");

test("provider deletion awaits a snapshot containing the connection", async () => {
  const db = getDbInstance();
  db.prepare("INSERT OR REPLACE INTO key_value (namespace, key, value) VALUES (?, ?, ?)").run("databaseSettings", "autoBackupEnabled", "true");
  db.prepare("INSERT INTO provider_connections (id, provider, auth_type, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
    .run("prewrite-provider", "fixture", "apikey", new Date().toISOString(), new Date().toISOString());
  const original = db.backup;
  let release!: () => void;
  const gate = new Promise<void>(r => { release = r; });
  let started!: () => void;
  const backupStarted = new Promise<void>(r => { started = r; });
  db.backup = async destination => { started(); await gate; await original(destination); };
  try {
    const deleting = deleteProviderConnection("prewrite-provider");
    await Promise.race([backupStarted, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("backup did not start")), 1000))]);
    expect(db.prepare("SELECT id FROM provider_connections WHERE id = ?").get("prewrite-provider")).toBeTruthy();
    release();
    expect(await deleting).toBe(true);
    const filename = readdirSync(DB_BACKUPS_DIR!).find(n => n.endsWith("_pre-write.sqlite"));
    expect(filename).toBeTruthy();
    const snapshot = new Database(join(DB_BACKUPS_DIR!, filename!), { readonly: true });
    try { expect(snapshot.query("SELECT id FROM provider_connections WHERE id = ?").get("prewrite-provider")).toBeTruthy(); }
    finally { snapshot.close(); }
  } finally { release(); db.backup = original; }
});

test("provider-wide deletion does not delete connections inserted while backup is pending", async () => {
  const db = getDbInstance();
  const insert = db.prepare("INSERT INTO provider_connections (id, provider, auth_type, created_at, updated_at) VALUES (?, ?, ?, ?, ?)");
  const now = new Date().toISOString();
  insert.run("race-old", "race-provider", "apikey", now, now);
  const original = db.backup;
  let release!: () => void;
  let started!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const backupStarted = new Promise<void>(resolve => { started = resolve; });
  db.backup = async destination => { started(); await gate; await original(destination); };
  try {
    const deleting = deleteProviderConnectionsByProvider("race-provider");
    await Promise.race([backupStarted, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("backup did not start")), 1000))]);
    insert.run("race-new", "race-provider", "apikey", now, now);
    release();
    expect(await deleting).toBe(1);
    expect(db.prepare("SELECT id FROM provider_connections WHERE id = ?").get("race-new")).toBeTruthy();
  } finally { release(); db.backup = original; }
});

test("key deletion awaits a snapshot containing the key", async () => {
  const db = getDbInstance();
  db.prepare("INSERT INTO api_keys (id, name, key, machine_id, created_at) VALUES (?, ?, ?, ?, ?)")
    .run("prewrite-key", "fixture", "fixture-key", "fixture-machine", new Date().toISOString());
  const original = db.backup;
  const before = new Set(readdirSync(DB_BACKUPS_DIR!));
  let release!: () => void;
  const gate = new Promise<void>(r => { release = r; });
  let started!: () => void;
  const backupStarted = new Promise<void>(r => { started = r; });
  db.backup = async destination => { started(); await gate; await original(destination); };
  try {
    const deleting = deleteApiKey("prewrite-key");
    await Promise.race([backupStarted, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("backup did not start")), 1000))]);
    expect(db.prepare("SELECT id FROM api_keys WHERE id = ?").get("prewrite-key")).toBeTruthy();
    release();
    expect(await deleting).toBe(true);
    const snapshots = readdirSync(DB_BACKUPS_DIR!).filter(n => n.endsWith("_pre-write.sqlite") && !before.has(n));
    expect(snapshots.length).toBe(1);
    const snapshot = new Database(join(DB_BACKUPS_DIR!, snapshots[0]), { readonly: true });
    try { expect(snapshot.query("SELECT id FROM api_keys WHERE id = ?").get("prewrite-key")).toBeTruthy(); }
    finally { snapshot.close(); }
  } finally { release(); db.backup = original; }
});
