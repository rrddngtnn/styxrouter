import { expect, test } from "bun:test";
import { getDbInstance } from "../src/lib/db/core";
import { Database } from "bun:sqlite";
import { cleanupStaleSessionAccountAffinities } from "../src/lib/db/sessionAccountAffinity";

const ns = "session_account_affinity";
const expired = JSON.stringify({connectionId:"old", expiresAt:"2000-01-01T00:00:00.000Z"});
const fresh = JSON.stringify({connectionId:"new", expiresAt:"2999-01-01T00:00:00.000Z"});

test("cleanup reads inside a write transaction and rolls back on failure", () => {
  const db = getDbInstance();
  db.prepare("DELETE FROM key_value WHERE namespace = ?").run(ns);
  const insert = db.prepare("INSERT INTO key_value(namespace,key,value) VALUES(?,?,?)");
  insert.run(ns, "a", expired); insert.run(ns, "b", expired);
  db.exec("CREATE TRIGGER affinity_cleanup_abort BEFORE DELETE ON key_value WHEN OLD.namespace = 'session_account_affinity' AND OLD.key = 'b' BEGIN SELECT RAISE(ABORT, 'injected crash'); END");
  const original = db.prepare.bind(db);
  const competitor = new Database(db.name);
  competitor.exec("PRAGMA busy_timeout=0");
  let writeBlocked = false;
  (db as any).prepare = (sql: string) => {
    if (sql.includes("SELECT key, value FROM key_value")) {
      try { competitor.prepare("UPDATE key_value SET value = ? WHERE namespace = ? AND key = ?").run(fresh, ns, "a"); }
      catch (e) { if (!String(e).includes("locked")) throw e; writeBlocked = true; }
    }
    return original(sql);
  };
  try {
    expect(() => cleanupStaleSessionAccountAffinities()).toThrow("injected crash");
    expect(writeBlocked).toBe(true);
    expect((original("SELECT count(*) n FROM key_value WHERE namespace = ?").get(ns) as any).n).toBe(2);
  } finally { (db as any).prepare = original; competitor.close(); db.exec("DROP TRIGGER affinity_cleanup_abort"); }
  expect(cleanupStaleSessionAccountAffinities()).toBe(2);
});

test("Hono startup cleans stale affinity but retains live rows", async () => {
  const db = getDbInstance();
  const insert = db.prepare("INSERT OR REPLACE INTO key_value(namespace,key,value) VALUES(?,?,?)");
  insert.run(ns, "startup-old", expired); insert.run(ns, "startup-live", fresh);
  await import("../server/styx.ts");
  const read = db.prepare("SELECT value FROM key_value WHERE namespace = ? AND key = ?");
  expect(read.get(ns, "startup-old") == null).toBe(true);
  expect((read.get(ns, "startup-live") as any).value).toBe(fresh);
}, 30000);

test("SQLite recovers an interrupted cleanup transaction after process death", () => {
  const db = getDbInstance();
  db.prepare("INSERT OR REPLACE INTO key_value(namespace,key,value) VALUES(?,?,?)").run(ns, "crash", expired);
  const child = Bun.spawnSync([process.execPath, "-e", `
    const { Database } = require('bun:sqlite');
    const db = new Database(process.argv[1]);
    db.exec('BEGIN IMMEDIATE');
    db.prepare('DELETE FROM key_value WHERE namespace = ? AND key = ?').run('session_account_affinity', 'crash');
    process.kill(process.pid, 'SIGKILL');
  `, db.name], { stdout: "ignore", stderr: "pipe" });
  expect(child.exitCode).not.toBe(0);
  expect((db.prepare("SELECT value FROM key_value WHERE namespace = ? AND key = ?").get(ns, "crash") as any).value).toBe(expired);
  expect(cleanupStaleSessionAccountAffinities()).toBeGreaterThan(0);
});
