import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startTestServer } from './helpers/start-test-server';
import { stopTestProcess } from './helpers/stop-test-process';

test('daily model trends retain model IDs that are JavaScript object property names', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'usage-model-key-'));
  let proc: any;
  try {
    const server = await startTestServer(process.execPath, { cwd: join(import.meta.dir, '..'), env: { ...process.env, DATA_DIR: dir, STYX_TEST_MODE: '1', JWT_SECRET: 'fixture-jwt-secret-01234567890123456789', API_KEY_SECRET: 'fixture-api-secret-01234567890123456789', INITIAL_PASSWORD: 'fixture-password' } });
    proc = server.proc;
    const login = await fetch(server.base + '/api/auth/login', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({password:'fixture-password'}) });
    expect(login.status).toBe(200);
    const cookie = login.headers.get('set-cookie')!.split(';')[0];
    const db = new Database(join(dir, 'storage.sqlite'));
    const date = new Date().toISOString().slice(0, 10);
    try {
      const insert = db.prepare('INSERT INTO usage_history(timestamp,provider,model,tokens_input,tokens_output,success) VALUES (?,?,?,?,?,?)');
      insert.run(new Date().toISOString(), 'fixture', 'constructor', 3, 7, 1);
      insert.run(new Date().toISOString(), 'fixture', '__proto__', 4, 6, 1);
    } finally { db.close(); }
    const response = await fetch(server.base + '/api/usage/analytics?range=all', {headers:{cookie}});
    expect(response.status).toBe(200);
    const result: any = await response.json();
    const day = result.dailyByModel.find((row: any) => row.date === date);
    expect(day.constructor).toBe(10);
    expect(Object.hasOwn(day, '__proto__')).toBe(true);
    expect(day['__proto__']).toBe(10);
  } finally {
    if (proc) await stopTestProcess(proc);
    rmSync(dir, {recursive:true, force:true});
  }
}, 60000);
