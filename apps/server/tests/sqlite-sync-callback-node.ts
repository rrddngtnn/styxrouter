import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import BetterSqlite3 from "better-sqlite3";
import { createNodeSqliteAdapterFromDatabase } from "../src/lib/db/adapters/nodeSqliteShared";
import { createBetterSqliteAdapter } from "../src/lib/db/adapters/betterSqliteAdapter";
import type { SqliteAdapter } from "../src/lib/db/adapters/types";

for (const db of [createNodeSqliteAdapterFromDatabase(new DatabaseSync(":memory:"), ":memory:"), createBetterSqliteAdapter(new BetterSqlite3(":memory:"))]) {
  try {
    db.exec("CREATE TABLE t(value TEXT)");
    const insert = (value: string) => db.prepare("INSERT INTO t VALUES (?)").run(value);
    assert.equal(db.immediate(() => { insert("a"); return 3; }), 3);
    assert.equal(db.transaction(() => { insert("b"); return 4; })(), 4);
    let invoked = 0;
    const declaredAsync = async () => { invoked++; await Promise.resolve(); insert("late"); };
    assert.throws(() => db.immediate(declaredAsync as never), /synchronous/i);
    assert.throws(() => db.transaction(declaredAsync as never)(), /synchronous/i);
    assert.throws(() => db.immediate(declaredAsync.bind(null) as never), /synchronous/i);
    assert.equal(invoked, 0);
    await Promise.resolve();
    assert.deepEqual(db.prepare("SELECT value FROM t ORDER BY rowid").all(), [{value:"a"},{value:"b"}]);
    const asyncCallback = () => { insert("bad"); return Promise.reject(new Error("rejected")); };
    assert.throws(() => db.immediate(asyncCallback as never), /synchronous/i);
    assert.throws(() => db.transaction(asyncCallback as never)(), /synchronous/i);
    assert.equal(db.immediate(() => {
      insert("outer");
      assert.throws(() => db.immediate(asyncCallback as never), /synchronous/i);
      assert.throws(() => db.transaction(asyncCallback as never)(), /synchronous/i);
      return db.transaction(() => { insert("inner"); return 5; })();
    }), 5);
    assert.deepEqual(db.prepare("SELECT value FROM t ORDER BY rowid").all(), [{value:"a"},{value:"b"},{value:"outer"},{value:"inner"}]);
    // Detecting a returned promise cannot cancel its already-scheduled continuation.
    assert.throws(() => db.immediate((() => Promise.resolve().then(() => insert("escaped"))) as never), /synchronous/i);
    await Promise.resolve();
    assert.equal((db.prepare("SELECT value FROM t ORDER BY rowid DESC LIMIT 1").get() as { value: string }).value, "escaped");
    await new Promise(resolve => setTimeout(resolve, 20));
    console.log(`${db.driver}: passed`);
  } finally { db.close(); }
}
