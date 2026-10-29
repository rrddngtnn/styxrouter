// Persistence seam for validated imports. The caller must still run the import
// parser and provider compatibility checks before calling this function.
import type { SqliteAdapter } from "../src/lib/db/adapters/types";
import { saveImportedCredential, type ImportedCredential } from "../src/lib/db/importedCredential";
import { assertApiKeyIsNotManagementPassword } from "../src/lib/db/providers";

export async function persistTokenImport(db: SqliteAdapter, input: ImportedCredential) {
  if (input.authType === "apikey") await assertApiKeyIsNotManagementPassword(input.access, { failClosed: true });
  return saveImportedCredential(db, input, (transaction, id, provider) => {
    // This is deliberately not logAuditEvent: that function catches write errors
    // and would permit a connection to commit without its audit record.
    transaction.exec(`CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      action TEXT NOT NULL, actor TEXT NOT NULL DEFAULT 'system', target TEXT, details TEXT,
      ip_address TEXT, resource_type TEXT, status TEXT, request_id TEXT, metadata TEXT
    )`);
    const details = JSON.stringify({ provider });
    transaction.prepare(`INSERT INTO audit_log
      (timestamp, action, actor, target, details, resource_type, status, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(new Date().toISOString(), "connection.import", "admin", id, details, "admin_api", "success", details);
  });
}
