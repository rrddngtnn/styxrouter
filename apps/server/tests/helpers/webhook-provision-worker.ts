import { runtimeRequire } from "../../src/lib/db/adapters/runtimeRequire";
import { createBunSqliteAdapter, type BunSqliteDatabaseLike } from "../../src/lib/db/adapters/bunSqliteAdapter";
import { provisionManagedWebhook, rotateManagedWebhookSecret } from "../../src/lib/db/webhookProvisioning";

const { Database } = runtimeRequire("bun:sqlite") as { Database: new (path: string) => BunSqliteDatabaseLike };
declare const Bun: { stdin: { text(): Promise<string> } };
const [path, operation, key, id, version] = process.argv.slice(2);
const sqlite = new Database(path);
sqlite.exec("PRAGMA busy_timeout=10000");
const db = createBunSqliteAdapter(sqlite, path);
await Bun.stdin.text();
try {
  const result = operation === "create"
    ? provisionManagedWebhook(db, key, { url: "https://example.com/private-path?token=synthetic-url-token", events: ["test.ping"], description: "" })
    : rotateManagedWebhookSecret(db, key, id, version);
  console.log(JSON.stringify(result));
} catch { console.log(JSON.stringify({ status: "error" })); }
finally { db.close(); }
