import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createBunSqliteAdapter } from "../src/lib/db/adapters/bunSqliteAdapter";
import { saveImportedCredential } from "../src/lib/db/importedCredential";

process.env.STORAGE_ENCRYPTION_KEY = "synthetic-atomic-wiring-key";

test("a retry without a previously bound workspace fails closed", () => {
  const raw = new Database(":memory:");
  raw.exec(`CREATE TABLE key_value (namespace TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(namespace,key));
    CREATE TABLE provider_connections (id TEXT PRIMARY KEY, provider TEXT NOT NULL, auth_type TEXT, name TEXT, priority INTEGER, is_active INTEGER, access_token TEXT, refresh_token TEXT, api_key TEXT, expires_at TEXT, token_expires_at TEXT, provider_specific_data TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);`);
  const db = createBunSqliteAdapter(raw as any, ":memory:");
  const input = { provider: "codex", authType: "oauth" as const, access: "synthetic-access", name: "Imported", expiresAt: null, workspaceId: "workspace-a" };
  saveImportedCredential(db, input, () => {});
  expect(() => saveImportedCredential(db, { ...input, workspaceId: undefined }, () => {})).toThrow();
  raw.close();
});

test("separate persistence seam commits a redacted audit with the credential and deduplicates", async () => {
  const { persistTokenImport } = await import("../server/tokenImportPersistence");
  const raw = new Database(":memory:");
  raw.exec(`CREATE TABLE key_value (namespace TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(namespace,key));
    CREATE TABLE provider_connections (id TEXT PRIMARY KEY, provider TEXT NOT NULL, auth_type TEXT, name TEXT, priority INTEGER, is_active INTEGER, access_token TEXT, refresh_token TEXT, api_key TEXT, expires_at TEXT, token_expires_at TEXT, provider_specific_data TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);`);
  const db = createBunSqliteAdapter(raw as any, ":memory:");
  const input = { provider: "codebuddy-cn", authType: "oauth" as const, access: "synthetic-secret", name: "Imported", expiresAt: null };
  const a = await persistTokenImport(db, input);
  const b = await persistTokenImport(db, input);
  expect(b).toEqual({ id: a.id, created: false });
  expect(raw.query("SELECT action, actor, target, details FROM audit_log").all()).toEqual([{ action: "connection.import", actor: "admin", target: a.id, details: '{"provider":"codebuddy-cn"}' }]);
  expect(JSON.stringify(raw.query("SELECT * FROM provider_connections").all())).not.toContain("synthetic-secret");
  raw.exec("CREATE TRIGGER reject_audit BEFORE INSERT ON audit_log BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END");
  await expect(persistTokenImport(db, { ...input, access: "synthetic-second-secret" })).rejects.toThrow();
  expect(raw.query("SELECT count(*) AS n FROM provider_connections").get()).toEqual({ n: 1 });
  expect(raw.query("SELECT count(*) AS n FROM key_value").get()).toEqual({ n: 1 });
  expect(raw.query("SELECT count(*) AS n FROM audit_log").get()).toEqual({ n: 1 });
  raw.close();
});
