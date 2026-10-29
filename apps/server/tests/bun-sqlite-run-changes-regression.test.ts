import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createBunSqliteAdapter } from "../src/lib/db/adapters/bunSqliteAdapter";

for (const count of [1, 2]) {
  test(`run reports ${count} directly deleted rows, excluding generation triggers and cascades`, () => {
    const raw = new Database(":memory:");
    const db = createBunSqliteAdapter(raw, ":memory:");
    try {
      db.exec(`
        PRAGMA foreign_keys = ON;
        CREATE TABLE connections (id TEXT PRIMARY KEY);
        CREATE TABLE members (connection_id TEXT REFERENCES connections(id) ON DELETE CASCADE);
        CREATE TABLE generation (value INTEGER);
        INSERT INTO generation VALUES (0);
        INSERT INTO connections VALUES ('old-1'), ('old-2'), ('new');
        INSERT INTO members VALUES ('old-1'), ('old-2'), ('new');
        CREATE TRIGGER bump_generation AFTER DELETE ON connections
        BEGIN UPDATE generation SET value = value + 1; END;
      `);
      const ids = Array.from({ length: count }, (_, index) => `old-${index + 1}`);
      const result = db.prepare(`DELETE FROM connections WHERE id IN (${ids.map(() => "?").join(",")})`).run(...ids);
      // Verify actual effects independently of the reported row count.
      expect(db.prepare("SELECT id FROM connections WHERE id = 'new'").get()).toEqual({ id: "new" });
      expect(db.prepare("SELECT COUNT(*) AS count FROM connections").get()).toEqual({ count: 3 - count });
      expect(db.prepare("SELECT COUNT(*) AS count FROM members").get()).toEqual({ count: 3 - count });
      expect(db.prepare("SELECT value FROM generation").get()).toEqual({ value: count });
      expect(result.changes).toBe(count);
      expect(db.prepare("DELETE FROM connections WHERE id = 'missing'").run().changes).toBe(0);
    } finally {
      db.close();
    }
  });
}

test("run preserves lastInsertRowid and excludes insert/update trigger writes", () => {
  const raw = new Database(":memory:");
  const db = createBunSqliteAdapter(raw, ":memory:");
  try {
    db.exec(`
      CREATE TABLE records (id INTEGER PRIMARY KEY, value TEXT);
      CREATE TABLE audit (value TEXT);
      CREATE TRIGGER audit_insert AFTER INSERT ON records
      BEGIN INSERT INTO audit VALUES (NEW.value); END;
      CREATE TRIGGER audit_update AFTER UPDATE ON records
      BEGIN INSERT INTO audit VALUES (NEW.value); END;
    `);
    expect(db.prepare("INSERT INTO records (id, value) VALUES (?, ?)").run(42, "first"))
      .toEqual({ changes: 1, lastInsertRowid: 42 });
    expect(db.prepare("UPDATE records SET value = ? WHERE id = ?").run("second", 42))
      .toEqual({ changes: 1, lastInsertRowid: 42 });
    expect(db.prepare("SELECT value FROM audit ORDER BY rowid").all())
      .toEqual([{ value: "first" }, { value: "second" }]);
  } finally {
    db.close();
  }
});
