import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { readFileSync, mkdtempSync, copyFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createBunSqliteAdapter } from '../src/lib/db/adapters/bunSqliteAdapter';

test('184 upgrades historical ledger and preserves old triggers alongside all-write triggers', async () => {
 const dir=mkdtempSync(join(tmpdir(),'migration184-')); const old=process.env.STYX_MIGRATIONS_DIR;
 copyFileSync(new URL('../src/lib/db/migrations/184_connection_cache_revision.sql',import.meta.url),join(dir,'184_connection_cache_revision.sql'));
 process.env.STYX_MIGRATIONS_DIR=dir;
 const db=new Database(':memory:');
 try {
  db.exec(`CREATE TABLE _styx_migrations(version TEXT PRIMARY KEY,name TEXT NOT NULL,applied_at TEXT DEFAULT 'historic'); INSERT INTO _styx_migrations(version,name) VALUES ('182','catalog_context_revision'),('183','provider_limits_cache_revision'); CREATE TABLE db_meta(key TEXT PRIMARY KEY,value TEXT); CREATE TABLE provider_connections(id TEXT PRIMARY KEY,provider TEXT,is_active INTEGER,name TEXT); CREATE TABLE key_value(namespace TEXT,key TEXT,value TEXT); CREATE TABLE model_context_overrides(id TEXT);`);
  db.exec(readFileSync(new URL('../src/lib/db/migrations/182_catalog_context_revision.sql',import.meta.url),'utf8'));
  const {runMigrations}=await import('../src/lib/db/migrationRunner.ts?review184'); const a=createBunSqliteAdapter(db,':memory:');
  expect(runMigrations(a)).toBe(1); expect(runMigrations(a)).toBe(0);
  expect(db.query('SELECT version,name,applied_at FROM _styx_migrations ORDER BY version').all()).toEqual([{version:'182',name:'catalog_context_revision',applied_at:'historic'},{version:'183',name:'provider_limits_cache_revision',applied_at:'historic'}, expect.objectContaining({version:'184',name:'connection_cache_revision'})]);
  const revision=()=>Number((db.query("SELECT value FROM db_meta WHERE key='catalog_context_revision'").get() as any).value);
  const initial=revision(); db.exec("INSERT INTO provider_connections VALUES ('x','codex',1,'first')"); expect(revision()).toBe(initial+2);
  db.exec("UPDATE provider_connections SET name='second' WHERE id='x'"); expect(revision()).toBe(initial+3);
  db.exec("UPDATE provider_connections SET is_active=0 WHERE id='x'"); expect(revision()).toBe(initial+5);
  db.exec("DELETE FROM provider_connections WHERE id='x'"); expect(revision()).toBe(initial+7);
  db.exec("BEGIN; INSERT INTO provider_connections VALUES ('x','openai',1,'first'); ROLLBACK"); expect(revision()).toBe(initial+7);
 } finally { db.close(); rmSync(dir,{recursive:true,force:true}); if(old===undefined) delete process.env.STYX_MIGRATIONS_DIR; else process.env.STYX_MIGRATIONS_DIR=old; }
});
