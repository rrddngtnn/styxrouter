import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startTestServer } from './helpers/start-test-server';
import { stopTestProcess } from './helpers/stop-test-process';

test('a model named date cannot overwrite the daily trend date', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'usage-date-model-'));
  let proc: any;
  try {
    const server = await startTestServer(process.execPath, { cwd: join(import.meta.dir, '..'), env: { ...process.env, DATA_DIR: dir, STYX_TEST_MODE: '1', JWT_SECRET: 'fixture-jwt-secret-01234567890123456789', API_KEY_SECRET: 'fixture-api-secret-01234567890123456789', INITIAL_PASSWORD: 'fixture-password' } });
    proc = server.proc;
    const login = await fetch(server.base + '/api/auth/login', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({password:'fixture-password'}) });
    expect(login.status).toBe(200);
    const cookie = login.headers.get('set-cookie')!.split(';')[0];
    const db = new Database(join(dir, 'storage.sqlite'));
    const timestamp = new Date().toISOString();
    try { db.prepare('INSERT INTO usage_history(timestamp,provider,model,tokens_input,tokens_output,success) VALUES (?,?,?,?,?,?)').run(timestamp, 'fixture', 'date', 3, 7, 1); } finally { db.close(); }
    const response = await fetch(server.base + '/api/usage/analytics?range=all', {headers:{cookie}});
    expect(response.status).toBe(200);
    const result: any = await response.json();
    expect(result.dailyByModel[0].date).toBe(timestamp.slice(0,10));
    expect(result.dailyByModel[0]['model:date']).toBe(10);
    expect(result.modelNames).toContain('model:date');
  } finally {
    if (proc) await stopTestProcess(proc);
    rmSync(dir, {recursive:true, force:true});
  }
}, 60000);
