import { afterAll, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createBunSqliteAdapter } from '../src/lib/db/adapters/bunSqliteAdapter';
const dir=mkdtempSync(join(process.env.TMPDIR!, 'quota-migration-183-'));
process.env.STYX_MIGRATIONS_DIR=dir; process.env.STYX_EXTRA_MIGRATIONS_DIRS='';
const {runMigrations}=await import('../src/lib/db/migrationRunner');
afterAll(()=>rmSync(dir,{recursive:true,force:true}));
test('historic cache survives upgrade and gains durable per-key tombstones',()=>{
 copyFileSync(new URL('../src/lib/db/migrations/183_provider_limits_cache_revision.sql',import.meta.url),join(dir,'183_provider_limits_cache_revision.sql'));
 const db=new Database(':memory:');
 try {
  db.exec(`CREATE TABLE _styx_migrations(version TEXT PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT DEFAULT 'historic');
  INSERT INTO _styx_migrations(version,name) VALUES ('182','catalog_context_revision');
  CREATE TABLE key_value(namespace TEXT NOT NULL,key TEXT NOT NULL,value TEXT,PRIMARY KEY(namespace,key));
  INSERT INTO key_value VALUES('providerLimitsCache','old','original');`);
  const adapter=createBunSqliteAdapter(db,':memory:'); expect(runMigrations(adapter)).toBe(1);
  expect(db.query("SELECT value FROM key_value WHERE key='old'").get()).toEqual({value:'original'});
  db.exec("DELETE FROM key_value WHERE namespace='providerLimitsCache' AND key='old'; INSERT INTO key_value VALUES('providerLimitsCache','old','original');");
  expect(db.query("SELECT revision FROM provider_limits_cache_revisions WHERE key='old'").get()).toEqual({revision:2});
  expect(runMigrations(adapter)).toBe(0);
  expect(db.query("SELECT applied_at FROM _styx_migrations WHERE version='182'").get()).toEqual({applied_at:'historic'});
 } finally {db.close();}
});
test('failed legacy upgrade rolls back migration objects and marker and can retry',()=>{
 const db=new Database(':memory:');
 try {
  db.exec(`CREATE TABLE _styx_migrations(version TEXT PRIMARY KEY,name TEXT NOT NULL,applied_at TEXT DEFAULT 'legacy'); INSERT INTO _styx_migrations(version,name) VALUES('182','catalog_context_revision');`);
  const adapter=createBunSqliteAdapter(db,':memory:');
  expect(()=>runMigrations(adapter)).toThrow();
  expect(db.query("SELECT name FROM sqlite_master WHERE name='provider_limits_cache_revisions'").get()).toBeNull();
  expect(db.query("SELECT version FROM _styx_migrations WHERE version='183'").get()).toBeNull();
  db.exec(`CREATE TABLE key_value(namespace TEXT NOT NULL,key TEXT NOT NULL,value TEXT,PRIMARY KEY(namespace,key)); INSERT INTO key_value VALUES('providerLimitsCache','legacy','historic');`);
  expect(runMigrations(adapter)).toBe(1);
  expect(db.query("SELECT value FROM key_value WHERE key='legacy'").get()).toEqual({value:'historic'});
 } finally {db.close();}
});
test('trigger mutations, namespace transitions and transaction rollback preserve revisions',()=>{
 const db=new Database(':memory:');
 try {
  db.exec(`CREATE TABLE key_value(namespace TEXT NOT NULL,key TEXT NOT NULL,value TEXT,PRIMARY KEY(namespace,key));`);
  expect(runMigrations(createBunSqliteAdapter(db,':memory:'))).toBe(1);
  const revision=(key:string)=>(db.query('SELECT revision FROM provider_limits_cache_revisions WHERE key=?').get(key) as {revision:number}|null)?.revision ?? 0;
  db.exec(`INSERT INTO key_value VALUES('providerLimitsCache','a','one'); UPDATE key_value SET value=value WHERE key='a';`);
  expect(revision('a')).toBe(1);
  db.exec(`BEGIN; UPDATE key_value SET value='two' WHERE key='a'; DELETE FROM key_value WHERE key='a'; ROLLBACK;`);
  expect(revision('a')).toBe(1); expect(db.query("SELECT value FROM key_value WHERE key='a'").get()).toEqual({value:'one'});
  db.exec(`UPDATE key_value SET key='b' WHERE key='a'; UPDATE key_value SET namespace='other' WHERE key='b'; UPDATE key_value SET namespace='providerLimitsCache' WHERE key='b';`);
  expect(revision('a')).toBe(2); expect(revision('b')).toBe(3);
  db.exec(`INSERT OR REPLACE INTO key_value VALUES('providerLimitsCache','b','one');`);
  expect(revision('b')).toBeGreaterThan(3);
 } finally {db.close();}
});