import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createBunSqliteAdapter } from "../src/lib/db/adapters/bunSqliteAdapter";
import { saveImportedCredential } from "../src/lib/db/importedCredential";

process.env.STORAGE_ENCRYPTION_KEY = "synthetic-mixed-dedupe-key";
function setup() {
  const raw = new Database(":memory:");
  raw.exec(`CREATE TABLE key_value (namespace TEXT, key TEXT, value TEXT, PRIMARY KEY(namespace,key));
    CREATE TABLE provider_connections (id TEXT PRIMARY KEY, provider TEXT, auth_type TEXT, name TEXT, priority INTEGER, is_active INTEGER, access_token TEXT, refresh_token TEXT, api_key TEXT, expires_at TEXT, token_expires_at TEXT, provider_specific_data TEXT, created_at TEXT, updated_at TEXT)`);
  return { raw, db: createBunSqliteAdapter(raw as any, ":memory:") };
}
const base = { provider: "codebuddy-cn", authType: "oauth" as const, access: "synthetic-access", name: "Imported", expiresAt: null };
const audit = () => {};
test("access-only then a pair never creates a duplicate or silently attaches refresh", () => {
  const { raw, db } = setup();
  saveImportedCredential(db, base, audit);
  expect(() => saveImportedCredential(db, { ...base, refresh: "synthetic-refresh" }, audit)).toThrow();
  expect(raw.query("SELECT count(*) n FROM provider_connections").get()).toEqual({ n: 1 });
  expect(raw.query("SELECT refresh_token FROM provider_connections").get()).toEqual({ refresh_token: null });
  raw.close();
});
test("conflicting matches in existing mixed connections fail closed", () => {
  const { raw, db } = setup();
  saveImportedCredential(db, base, audit);
  saveImportedCredential(db, { ...base, access: "another-access", refresh: "synthetic-refresh" }, audit);
  expect(() => saveImportedCredential(db, { ...base, refresh: "synthetic-refresh" }, audit)).toThrow();
  expect(raw.query("SELECT count(*) n FROM provider_connections").get()).toEqual({ n: 2 });
  raw.close();
});
test("same access with conflicting refresh fails without overwriting", () => {
  const { raw, db } = setup();
  saveImportedCredential(db, { ...base, refresh: "refresh-one" }, audit);
  expect(() => saveImportedCredential(db, { ...base, refresh: "refresh-two" }, audit)).toThrow();
  expect(raw.query("SELECT count(*) n FROM provider_connections").get()).toEqual({ n: 1 });
  raw.close();
});
