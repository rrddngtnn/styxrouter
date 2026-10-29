import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createBunSqliteAdapter } from "../src/lib/db/adapters/bunSqliteAdapter";

test("immediate returns callback value after commit and rolls back on error", () => {
  const db = createBunSqliteAdapter(new Database(":memory:"), ":memory:");
  try {
    db.exec("CREATE TABLE entries (value TEXT)");
    const value = db.immediate(() => {
      db.prepare("INSERT INTO entries VALUES (?)").run("committed");
      return { value: "committed" };
    });
    expect(value).toEqual({ value: "committed" });
    expect(db.immediate(() => null)).toBeNull();
    expect(db.immediate(() => undefined)).toBeUndefined();
    expect(() => db.immediate(() => {
      db.prepare("INSERT INTO entries VALUES (?)").run("rolled back");
      throw new Error("rollback");
    })).toThrow("rollback");
    expect(db.prepare("SELECT value FROM entries").all()).toEqual([{ value: "committed" }]);
  } finally {
    db.close();
  }
});
