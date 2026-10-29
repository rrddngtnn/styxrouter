import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startTestServer } from './helpers/start-test-server';
import { stopTestProcess } from './helpers/stop-test-process';

test('analytics uses exact special-name provider and model pricing', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'special-pricing-'));
  let proc: any;
  try {
    const server = await startTestServer(process.execPath, { cwd: join(import.meta.dir, '..'), env: { ...process.env, DATA_DIR: dir, STYX_TEST_MODE: '1', JWT_SECRET: 'fixture-jwt-secret-01234567890123456789', API_KEY_SECRET: 'fixture-api-secret-01234567890123456789', INITIAL_PASSWORD: 'fixture-password' } });
    proc = server.proc;
    const login = await fetch(server.base + '/api/auth/login', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({password:'fixture-password'}) });
    expect(login.status).toBe(200);
    const cookie = login.headers.get('set-cookie')!.split(';')[0];
    const db = new Database(join(dir, 'storage.sqlite'));
    try {
      const insert = db.prepare('INSERT INTO usage_history(timestamp,provider,model,tokens_input,tokens_output,success) VALUES (?,?,?,?,?,?)');
      insert.run(new Date().toISOString(), '__proto__', 'constructor', 1000000, 0, 1);
      insert.run(new Date().toISOString(), 'constructor', '__proto__', 1000000, 0, 1);
      insert.run(new Date().toISOString(), 'toString', 'unpriced-fixture-model', 1, 0, 1);
      const pricing = db.prepare("INSERT OR REPLACE INTO key_value(namespace,key,value) VALUES ('pricing',?,?)");
      pricing.run('__proto__', JSON.stringify({constructor:{input:2,output:0}}));
      pricing.run('constructor', JSON.stringify(JSON.parse('{"__proto__":{"input":3,"output":0}}')));
    } finally { db.close(); }
    const response = await fetch(server.base + '/api/usage/analytics?range=all', {headers:{cookie}});
    expect(response.status).toBe(200);
    const result: any = await response.json();
    expect(result.byModel.find((r: any) => r.provider === '__proto__' && r.model === 'constructor')?.cost).toBe(2);
    expect(result.byModel.find((r: any) => r.provider === 'constructor' && r.model === '__proto__')?.cost).toBe(3);
    expect(result.byProvider.find((r: any) => r.providerId === 'constructor')?.provider).toBe('constructor');
    expect(result.summary.totalCost).toBe(5);
  } finally {
    if (proc) await stopTestProcess(proc);
    rmSync(dir, {recursive:true, force:true});
  }
}, 60000);
