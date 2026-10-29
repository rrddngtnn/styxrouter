import { test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { createBunSqliteAdapter } from "../src/lib/db/adapters/bunSqliteAdapter";
import { createNodeSqliteAdapterFromDatabase } from "../src/lib/db/adapters/nodeSqliteShared";
import { createBetterSqliteAdapter } from "../src/lib/db/adapters/betterSqliteAdapter";
import { createSqlJsAdapter } from "../src/lib/db/adapters/sqljsAdapter";
import type { SqliteAdapter } from "../src/lib/db/adapters/types";

const factories: [string, () => Promise<SqliteAdapter>][] = [
  ["bun:sqlite", async () => createBunSqliteAdapter(new Database(":memory:"), ":memory:")],
  ["sql.js", () => createSqlJsAdapter(":memory:")],
];
// Native Node drivers are exercised by sqlite-sync-callback-node.ts under Node.
for (const [driver, factory] of factories) {
  test(`${driver} rejects async callbacks and rolls back`, async () => {
    const db = await factory();
    try { await exercise(db); } finally { db.close(); }
  });
}

export async function exercise(db: SqliteAdapter) {
  db.exec("CREATE TABLE entries(value TEXT)");
  const insert = (value: string) => db.prepare("INSERT INTO entries VALUES (?)").run(value);
  const rows = () => db.prepare("SELECT value FROM entries ORDER BY rowid").all();
  expect(db.immediate(() => { insert("one"); return 42; })).toBe(42);
  expect(db.transaction(() => { insert("two"); return "result"; })()).toBe("result");
  let invoked = 0;
  const declaredAsync = async () => { invoked++; await Promise.resolve(); insert("late"); };
  expect(() => db.immediate(declaredAsync as never)).toThrow(/synchronous/i);
  expect(() => db.transaction(declaredAsync as never)()).toThrow(/synchronous/i);
  expect(() => db.immediate(declaredAsync.bind(null) as never)).toThrow(/synchronous/i);
  expect(invoked).toBe(0);
  await Promise.resolve();
  expect(rows()).toEqual([{ value: "one" }, { value: "two" }]);
  const asyncCallback = () => { insert("bad"); return Promise.reject(new Error("rejected callback")); };
  expect(() => db.immediate(asyncCallback as never)).toThrow(/synchronous/i);
  expect(() => db.transaction(asyncCallback as never)()).toThrow(/synchronous/i);
  expect(() => db.immediate((() => { insert("bad"); return Promise.resolve(1); }) as never)).toThrow(/synchronous/i);
  expect(() => db.immediate((() => { insert("bad"); return { then(resolve: (value: number) => void) { resolve(1); } }; }) as never)).toThrow(/synchronous/i);
  expect(db.immediate(() => {
    insert("outer");
    expect(() => db.immediate(asyncCallback as never)).toThrow(/synchronous/i);
    expect(() => db.transaction(asyncCallback as never)()).toThrow(/synchronous/i);
    return db.transaction(() => { insert("inner"); return 7; })();
  })).toBe(7);
  expect(rows()).toEqual([{ value: "one" }, { value: "two" }, { value: "outer" }, { value: "inner" }]);
  // A non-async wrapper can schedule work before its returned promise is detected.
  expect(() => db.immediate((() => Promise.resolve().then(() => insert("escaped"))) as never)).toThrow(/synchronous/i);
  await Promise.resolve();
  expect(rows().at(-1)).toEqual({ value: "escaped" });
  await new Promise((resolve) => setTimeout(resolve, 20));
}
