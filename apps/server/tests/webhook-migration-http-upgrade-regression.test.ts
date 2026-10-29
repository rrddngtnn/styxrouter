import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { SignJWT } from "jose";
import { createBunSqliteAdapter } from "../src/lib/db/adapters/bunSqliteAdapter";
import { decrypt } from "../src/lib/db/encryption";

test("historical ledger upgrade supports encrypted idempotent provisioning across two HTTP processes", async () => {
  const dir = mkdtempSync(join(process.env.TMPDIR!, "webhook-upgrade-"));
  const path = join(dir, "history.sqlite");
  const migrations = join(dir, "migrations");
  const { mkdirSync } = await import("node:fs"); mkdirSync(migrations);
  const migration = new URL("../src/lib/db/migrations/185_webhook_provisioning.sql", import.meta.url);
  expect(existsSync(migration)).toBe(true);
  copyFileSync(migration, join(migrations, "185_webhook_provisioning.sql"));
  process.env.STYX_MIGRATIONS_DIR = migrations; process.env.STYX_EXTRA_MIGRATIONS_DIRS = "";
  const { runMigrations } = await import("../src/lib/db/migrationRunner");
  const key = "synthetic-upgrade-encryption-key"; process.env.STORAGE_ENCRYPTION_KEY = key;
  const db = new Database(path);
  db.exec(`PRAGMA journal_mode=WAL; CREATE TABLE _styx_migrations(version TEXT PRIMARY KEY,name TEXT NOT NULL,applied_at TEXT DEFAULT 'historic'); INSERT INTO _styx_migrations VALUES('184','connection_cache_revision','historic');`);
  db.exec(readFileSync(new URL("../src/lib/db/migrations/011_webhooks.sql", import.meta.url), "utf8"));
  db.exec(readFileSync(new URL("../src/lib/db/migrations/070_webhooks_kind_metadata.sql", import.meta.url), "utf8"));
  db.exec("INSERT INTO webhooks(id,url,events,secret,description) VALUES('legacy','https://legacy.example','[]','legacy-secret','historic')");
  const adapter = createBunSqliteAdapter(db, path);
  const workers: ReturnType<typeof Bun.spawn>[] = [];
  try {
    expect(runMigrations(adapter)).toBe(1); expect(runMigrations(adapter)).toBe(0);
    // Re-running SQL after a lost ledger marker must preserve existing rows.
    db.exec("INSERT INTO audit_log(timestamp,action,actor,target) VALUES('historic','legacy','system','legacy')");
    const sql = readFileSync(migration, "utf8"); db.exec(sql); db.exec(sql);
    expect(db.query("SELECT target FROM audit_log WHERE action='legacy'").get()).toEqual({target:'legacy'});
    db.exec("DELETE FROM audit_log WHERE action='legacy'");
    expect(db.query("SELECT applied_at FROM _styx_migrations WHERE version='184'").get()).toEqual({ applied_at: "historic" });
    expect(db.query("SELECT secret FROM webhooks WHERE id='legacy'").get()).toEqual({ secret: "legacy-secret" });
    for (let i=0; i<2; i++) workers.push(Bun.spawn([process.execPath, join(import.meta.dir, "helpers/webhook-http-worker.ts"), path, join(dir, `port${i}`)], { stdout: "ignore", stderr: "pipe", env: { ...process.env, DATA_DIR: join(dir, `worker${i}`), SQLITE_FILE: join(dir, `worker${i}`, "storage.sqlite"), JWT_SECRET: "synthetic-http-jwt", STORAGE_ENCRYPTION_KEY: key } }));
    const deadline=Date.now()+15000;
    while (![0,1].every(i=>existsSync(join(dir,`port${i}`)))) { if(Date.now()>deadline || workers.some(p=>p.exitCode!==null)) throw new Error("worker startup failed"); await Bun.sleep(20); }
    const ports=[0,1].map(i=>readFileSync(join(dir,`port${i}`),"utf8"));
    const token=await new SignJWT({ authenticated:true }).setProtectedHeader({alg:"HS256"}).sign(new TextEncoder().encode("synthetic-http-jwt"));
    const call=(i:number, endpoint:string, requestKey:string, body:string, version = "")=>fetch(`http://127.0.0.1:${ports[i]}${endpoint}`,{method:"POST",headers:{"content-type":"application/json",cookie:`auth_token=${token}`,"idempotency-key":requestKey, "if-match":version},body});
    const body=JSON.stringify({url:"https://dns.example/private?token=hidden",events:["test.ping"]});
    const result=await Promise.all(ports.map((_,i)=>call(i,"/api/webhooks","synthetic-create-upgrade-0001",body)));
    expect(result.map(r=>r.status).sort()).toEqual([200,201]);
    const values:any[]=await Promise.all(result.map(r=>r.json())); expect(values[0].id).toBe(values[1].id);
    expect(values.filter(v=>v.secret)).toHaveLength(1);
    const secret=values.find(v=>v.secret).secret;
    const row:any=db.query("SELECT secret FROM webhooks WHERE id=?").get(values[0].id); expect(row.secret).toStartWith("enc:v1:"); expect(decrypt(row.secret,{quiet:true})).toBe(secret);
    expect(db.query("SELECT count(*) n FROM webhook_provision_requests").get()).toEqual({n:1});
    expect(db.query("SELECT count(*) n FROM audit_log").get()).toEqual({n:1});
    const visible=JSON.stringify([db.query("SELECT * FROM audit_log").all(),db.query("SELECT * FROM webhook_provision_requests").all()]);
    for(const text of [secret,"private","hidden","synthetic-create-upgrade-0001"]) expect(visible).not.toContain(text);
    db.exec("CREATE TRIGGER reject_webhook_audit BEFORE INSERT ON audit_log BEGIN SELECT RAISE(ABORT,'reject'); END");
    const failed=await Promise.all(ports.map((_,i)=>call(i,`/api/webhooks/${values[0].id}/rotate-secret`,"synthetic-rotate-upgrade-0001","",values.find(v=>v.secret).version)));
    expect(failed.map(r=>r.status)).toEqual([409,409]);
    expect(db.query("SELECT secret FROM webhooks WHERE id=?").get(values[0].id)).toEqual(row);
    expect(db.query("SELECT count(*) n FROM webhook_provision_requests").get()).toEqual({n:1});
  } finally { for(const p of workers) p.kill(); await Promise.all(workers.map(p=>p.exited)); db.close(); delete process.env.STORAGE_ENCRYPTION_KEY; rmSync(dir,{recursive:true,force:true}); }
}, 30000);
