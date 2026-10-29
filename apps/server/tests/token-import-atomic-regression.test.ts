import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createBunSqliteAdapter } from "../src/lib/db/adapters/bunSqliteAdapter";
import { saveImportedCredential } from "../src/lib/db/importedCredential";

function setup() {
  const raw = new Database(":memory:");
  raw.exec(`CREATE TABLE key_value (namespace TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(namespace,key));
    CREATE TABLE provider_connections (id TEXT PRIMARY KEY, provider TEXT NOT NULL, auth_type TEXT, name TEXT, priority INTEGER, is_active INTEGER, access_token TEXT, refresh_token TEXT, api_key TEXT, expires_at TEXT, token_expires_at TEXT, provider_specific_data TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);`);
  return { raw, db: createBunSqliteAdapter(raw as any, ":memory:") };
}
const input = { provider: "codebuddy-cn", authType: "oauth" as const, access: "private-access", refresh: "private-refresh", name: "Imported", expiresAt: null };
process.env.STORAGE_ENCRYPTION_KEY = "test-only-import-atomic-key";

test("retries return the same connection without changing rotated credentials", () => {
  const { db, raw } = setup();
  const a = saveImportedCredential(db, input, () => {});
  raw.query("UPDATE provider_connections SET refresh_token=? WHERE id=?").run("rotated", a.id);
  const b = saveImportedCredential(db, input, () => {});
  expect(b).toEqual({ id: a.id, created: false });
  expect(raw.query("SELECT refresh_token FROM provider_connections").get()).toEqual({ refresh_token: "rotated" });
  expect(raw.query("SELECT count(*) AS n FROM provider_connections").get()).toEqual({ n: 1 });
  expect(JSON.stringify(raw.query("SELECT * FROM key_value").all())).not.toContain("private-refresh");
  raw.close();
});

test("audit failure rolls back connection and durable marker", () => {
  const { db, raw } = setup();
  expect(() => saveImportedCredential(db, input, () => { throw new Error("secret audit detail"); })).toThrow();
  expect(raw.query("SELECT count(*) AS n FROM provider_connections").get()).toEqual({ n: 0 });
  expect(raw.query("SELECT count(*) AS n FROM key_value").get()).toEqual({ n: 0 });
  expect(saveImportedCredential(db, input, () => {}).created).toBe(true);
  raw.close();
});

test("same refresh with a different access token does not create a competitor", () => {
  const { db, raw } = setup();
  const a = saveImportedCredential(db, input, () => {});
  expect(saveImportedCredential(db, { ...input, access: "different-access" }, () => {})).toEqual({ id: a.id, created: false });
  expect(raw.query("SELECT count(*) AS n FROM provider_connections").get()).toEqual({ n: 1 });
  raw.close();
});

test("a previously existing encrypted refresh credential is reused", () => {
  const { db, raw } = setup();
  const a = saveImportedCredential(db, input, () => {});
  raw.exec("DELETE FROM key_value");
  expect(saveImportedCredential(db, input, () => {})).toEqual({ id: a.id, created: false });
  raw.close();
});

test("workspace conflicts do not silently reuse a marker", () => {
  const { db, raw } = setup();
  const codex = { ...input, provider: "codex", refresh: undefined, workspaceId: "workspace-a" };
  saveImportedCredential(db, codex, () => {});
  expect(() => saveImportedCredential(db, { ...codex, workspaceId: "workspace-b" }, () => {})).toThrow();
  raw.close();
});

test("undecryptable existing credentials fail closed", () => {
  const { db, raw } = setup();
  saveImportedCredential(db, input, () => {});
  raw.exec("DELETE FROM key_value; UPDATE provider_connections SET refresh_token='enc:v1:bad:bad:bad'");
  expect(() => saveImportedCredential(db, { ...input, refresh: "other" }, () => {})).toThrow();
  expect(raw.query("SELECT count(*) AS n FROM provider_connections").get()).toEqual({ n: 1 });
  raw.close();
});
