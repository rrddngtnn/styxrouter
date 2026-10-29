import { runtimeRequire } from "../../src/lib/db/adapters/runtimeRequire";
import type { BunSqliteDatabaseLike } from "../../src/lib/db/adapters/bunSqliteAdapter";
const { Database } = runtimeRequire("bun:sqlite") as { Database: new (path: string) => BunSqliteDatabaseLike };
import { createBunSqliteAdapter } from "../../src/lib/db/adapters/bunSqliteAdapter";
import { refreshImportedCodebuddyCn } from "../../src/lib/db/importedRefreshOrchestrator";
import { refreshCodebuddyCnToken } from "../../open-sse/services/tokenRefresh/providers/codebuddyCn";
import { refreshAccessToken } from "../../open-sse/services/tokenRefresh";
import { PROVIDERS } from "../../open-sse/config/constants";

const [path, url, mode] = process.argv.slice(2);
if (mode === "future") Date.now = () => 4_000_000_000_000;
const raw = new Database(path);
raw.exec("PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL");
const db = createBunSqliteAdapter(raw, path);
if (mode === "persistence") {
  const prepare = db.prepare.bind(db);
  db.prepare = (sql) => {
    const statement = prepare(sql);
    if (sql.startsWith("UPDATE provider_connections SET access_token")) {
      const run = statement.run.bind(statement);
      statement.run = (...args) => {
        const result = run(...args);
        console.log("PERSISTING");
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
        return result;
      };
    }
    return statement;
  };
}
try {
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    console.log("CLAIMED");
    if (mode === "before") await new Promise(() => {});
    const response = await nativeFetch(url, init);
    console.log("RECEIVED");
    if (mode === "after") await new Promise(() => {});
    return response;
  };
  if (mode === "raw" || mode === "raw-forged-flag") {
    if (!(await Reflect.apply(refreshCodebuddyCnToken, undefined, ["synthetic-old-refresh", null, null, mode === "raw-forged-flag"]))) throw new Error("denied");
  } else if (mode === "generic") {
    PROVIDERS["codebuddy-cn"] = { ...PROVIDERS["codebuddy-cn"], refreshUrl: url };
    if (!(await refreshAccessToken("codebuddy-cn", "synthetic-old-refresh", { connectionId: "id", providerSpecificData: {} }, null))) throw new Error("denied");
  } else {
    await refreshImportedCodebuddyCn(db, mode === "duplicate" ? "id2" : "id", "synthetic-old-refresh");
  }
  console.log("SUCCESS");
} catch (e) { console.log("DENIED " + String(e)); }
finally { raw.close(); }
