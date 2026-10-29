import { Database } from "bun:sqlite";
import { createBunSqliteAdapter } from "../../src/lib/db/adapters/bunSqliteAdapter";
import { refreshWithContext } from "./fence";
import { refreshCodebuddyCnToken } from "../../open-sse/services/tokenRefresh/providers/codebuddyCn";
import { refreshAccessToken } from "../../open-sse/services/tokenRefresh";
import { PROVIDERS } from "../../open-sse/config/constants";
const [path,url,id,mode = "raw"] = process.argv.slice(2);
const raw = new Database(path); raw.exec("PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL");
try {
  const db = createBunSqliteAdapter(raw as any, path);
  const context = { db, connectionId: id };
  if (mode === "generic") {
    PROVIDERS["codebuddy-cn"] = { refreshUrl: url } as any;
    await refreshAccessToken("codebuddy-cn", "old-refresh", { refreshContext: context }, null);
  } else {
    const original = globalThis.fetch;
    globalThis.fetch = ((_, init) => original(url, init)) as typeof fetch;
    try { await refreshCodebuddyCnToken("old-refresh", null, null, context); }
    finally { globalThis.fetch = original; }
  }
  console.log("SUCCESS");
} catch { console.log("DENIED"); } finally { raw.close(); }
