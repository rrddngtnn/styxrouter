import { afterAll, beforeAll, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startTestServer } from './helpers/start-test-server';

let proc: any, base: string, dir: string, cookie: string;
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'usage-scope-'));
  ({proc, base} = await startTestServer(process.execPath, {cwd: join(import.meta.dir, '..'), env: {...process.env, DATA_DIR: dir, STYX_TEST_MODE: '1', JWT_SECRET: 'usage-test-jwt-secret-0123456789abcdef', API_KEY_SECRET: 'usage-test-key-secret-0123456789abcdef', INITIAL_PASSWORD: 'usage-test-password'}}));
  const login = await fetch(`${base}/api/auth/login`, {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({password:'usage-test-password'})});
  expect(login.status).toBe(200);
  cookie = (login.headers.get('set-cookie') || '').split(';')[0];
  const db = new Database(join(dir, 'storage.sqlite'));
  const now = new Date().toISOString();
  const historic = new Date(Date.now()-100*86400000).toISOString().slice(0,10);
  const insert = db.prepare(`INSERT INTO usage_history(timestamp,provider,model,account_key,account_label,api_key_id,api_key_name,tokens_input,tokens_output,success,latency_ms) VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  insert.run(now,'alpha','alpha-model','acct-a','Account A','key-a','Key A',10,20,0,100);
  insert.run(now,'beta','beta-model','acct-b','Account B','key-b','Key B',100,200,1,200);
  insert.run(now,'alpha','shared-model','acct-a','Account A','key-a','Key A',3,7,1,100);
  insert.run(now,'beta','shared-model','acct-b','Account B','key-b','Key B',30,70,1,200);
  insert.run(now,'alpha','shared-model','acct-c','Account C','key-c','Key C',2,3,1,300);
  db.run(`INSERT INTO daily_usage_summary(date,provider,model,total_requests,total_input_tokens,total_output_tokens) VALUES (?, 'alpha','old-alpha',4,40,80), (?, 'beta','old-beta',8,400,800)`, [historic,historic]);
  db.run(`INSERT INTO call_logs(id,timestamp,provider,model,requested_model,status,error_type,api_key_id,api_key_name) VALUES ('a',?,'alpha','alpha-model','different',500,'alpha-error','key-a','Key A'),('b',?,'beta','beta-model','beta-model',429,'beta-error','key-b','Key B')`, [now,now]);
  db.run("UPDATE key_value SET value = '30' WHERE namespace = 'databaseSettings' AND key = 'usageHistory'");
  db.close();
});
afterAll(() => { proc?.kill('SIGKILL'); if(dir) rmSync(dir,{recursive:true,force:true}); });

test('global analytics keeps shared model providers separate', async () => {
  const response = await fetch(base+'/api/usage/analytics?range=all',{headers:{cookie}});
  expect(response.status).toBe(200);
  const j: any = await response.json();
  const rows = j.byModel.filter((m: any) => m.model === 'shared-model').sort((a: any,b: any)=>a.provider.localeCompare(b.provider));
  expect(rows.map((m: any)=>[m.provider,m.requests,m.totalTokens])).toEqual([['alpha',2,15],['beta',1,100]]);
  expect(Object.keys(rows[0]).sort()).toEqual(['model','provider','rawModel','requests','promptTokens','completionTokens','totalTokens','avgLatencyMs','successRatePct','lastUsed','cost'].sort());
  expect(j.byModel.reduce((sum: number, m: any) => sum + m.requests, 0)).toBe(j.summary.totalRequests);
  expect(j.byModel.reduce((sum: number, m: any) => sum + m.totalTokens, 0)).toBe(j.summary.totalTokens);
});
