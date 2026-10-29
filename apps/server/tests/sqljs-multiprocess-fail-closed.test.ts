import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createSqlJsAdapter } from "../src/lib/db/adapters/sqljsAdapter";

test("file-backed sql.js refuses to serve stale authorization after another process revokes a key", async () => {
  const dir = mkdtempSync(join(process.env.TMPDIR!, "sqljs-auth-"));
  const file = join(dir, "storage.sqlite");
  try {
    const db = new Database(file);
    db.run("CREATE TABLE api_keys (id TEXT PRIMARY KEY, active INTEGER)");
    db.run("INSERT INTO api_keys VALUES ('key', 1)");
    db.close();
    const writer = Bun.spawnSync([process.execPath, "-e", `
      const { Database } = require('bun:sqlite');
      const db = new Database(process.argv[1]);
      db.run("UPDATE api_keys SET active = 0 WHERE id = 'key'");
      db.close();
    `, file], { stdout: "pipe", stderr: "pipe" });
    expect(writer.exitCode).toBe(0);
    const child = Bun.spawnSync([process.execPath, "-e", `
      const { createSqlJsAdapter } = await import(process.argv[1]);
      try {
        const db = await createSqlJsAdapter(process.argv[2]);
        console.log('UNSAFE_OPEN', JSON.stringify(db.prepare('SELECT active FROM api_keys').get()));
        db.close();
        process.exit(0);
      } catch (error) {
        console.error(String(error));
        process.exit(42);
      }
    `, join(import.meta.dir, "../src/lib/db/adapters/sqljsAdapter.ts"), file], { stdout: "pipe", stderr: "pipe" });
    expect(child.exitCode).toBe(42);
    expect(child.stderr.toString()).toContain("file-backed sql.js is disabled");
    const verify = new Database(file, { readonly: true });
    try { expect(verify.query("SELECT active FROM api_keys").get()).toEqual({ active: 0 }); }
    finally { verify.close(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("concurrent independent sql.js processes both reject a shared file", async () => {
  const dir = mkdtempSync(join(process.env.TMPDIR!, "sqljs-concurrent-"));
  const file = join(dir, "storage.sqlite");
  const adapter = join(import.meta.dir, "../src/lib/db/adapters/sqljsAdapter.ts");
  const script = `
    const { createSqlJsAdapter } = await import(process.argv[1]);
    try { const db = await createSqlJsAdapter(process.argv[2]); db.close(); process.exit(0); }
    catch (error) { console.error(String(error)); process.exit(42); }
  `;
  try {
    const children = [0, 1].map(() => Bun.spawn([process.execPath, "-e", script, adapter, file], { stdout: "pipe", stderr: "pipe" }));
    const results = await Promise.all(children.map(async (child) => ({ code: await child.exited, error: await new Response(child.stderr).text() })));
    for (const result of results) {
      expect(result.code).toBe(42);
      expect(result.error).toContain("file-backed sql.js is disabled");
    }
    expect(Bun.file(file).size).toBe(0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("in-memory sql.js remains available", async () => {
  const db = await createSqlJsAdapter(":memory:");
  try {
    db.exec("CREATE TABLE sample (value INTEGER); INSERT INTO sample VALUES (1)");
    expect(db.prepare("SELECT value FROM sample").get()).toEqual({ value: 1 });
  } finally { db.close(); }
});
