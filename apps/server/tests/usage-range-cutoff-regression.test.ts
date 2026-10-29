import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startTestServer } from './helpers/start-test-server';

test('usage analytics includes the entire selected end date', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'usage-end-date-'));
  let proc: any;
  try {
    let base: string;
    ({proc, base} = await startTestServer(process.execPath, {cwd: join(import.meta.dir, '..'), env: {...process.env, DATA_DIR: dir, STYX_TEST_MODE: '1', JWT_SECRET: 'usage-test-jwt-secret-0123456789abcdef', API_KEY_SECRET: 'usage-test-key-secret-0123456789abcdef', INITIAL_PASSWORD: 'usage-test-password'}}));
    const login = await fetch(`${base}/api/auth/login`, {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({password:'usage-test-password'})});
    expect(login.status).toBe(200);
    const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
    const db = new Database(join(dir, 'storage.sqlite'));
    const today = new Date().toISOString().slice(0, 10);
    db.run(`INSERT INTO usage_history(timestamp,provider,model,tokens_input,tokens_output,success) VALUES (?, 'alpha','m',10,20,1)`, [`${today}T12:00:00.000Z`]);
    db.close();
    const response = await fetch(`${base}/api/usage/analytics?startDate=${today}&endDate=${today}`, {headers:{cookie}});
    expect(response.status).toBe(200);
    const body: any = await response.json();
    expect(body.summary.totalRequests).toBe(1);
    expect(body.summary.totalTokens).toBe(30);
    const precise = await fetch(`${base}/api/usage/analytics?startDate=${today}&endDate=${today}T11%3A00%3A00.000Z`, {headers:{cookie}});
    expect(precise.status).toBe(200);
    expect((await precise.json() as any).summary.totalRequests).toBe(0);
  } finally { proc?.kill('SIGKILL'); rmSync(dir, {recursive:true,force:true}); }
});
