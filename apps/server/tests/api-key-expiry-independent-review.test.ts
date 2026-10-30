import "./helpers/test-secrets";
import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createApiKey, getApiKeyMetadata, validateApiKey } from "../src/lib/db/apiKeys";
import { SQLITE_FILE, getDbInstance } from "../src/lib/db/core";
import { parseNullableTimestamp } from "../src/lib/db/apiKeys/rowParsers";
import { enforceApiKeyPolicy } from "../src/shared/utils/apiKeyPolicy";
import { startTestServer } from "./helpers/start-test-server";
import { stopTestProcess } from "./helpers/stop-test-process";

test("expiry parser preserves malformed nonempty values and exact expiry is denied", async () => {
  expect(parseNullableTimestamp(null)).toBeNull();
  expect(parseNullableTimestamp(' not-a-date ')).toBe('not-a-date');
  const key = await createApiKey('expiry-boundary-review', 'test');
  const now = 1900000000000;
  getDbInstance().prepare('UPDATE api_keys SET expires_at = ? WHERE id = ?').run(new Date(now).toISOString(), key.id);
  expect((await getApiKeyMetadata(key.key))?.expiresAt).toBe(new Date(now).toISOString());
  const original = Date.now;
  try {
    Date.now = () => now - 1;
    expect(await validateApiKey(key.key)).toBe(true);
    Date.now = () => now;
    expect(await validateApiKey(key.key)).toBe(false);
    const req = new Request('http://localhost/v1/messages/count_tokens', { headers: { authorization: `Bearer ${key.key}` } });
    expect((await enforceApiKeyPolicy(req, null)).rejection?.status).toBe(403);
  } finally { Date.now = original; }
});

test('full HTTP auth observes malformed expiry and revocation from a second process', async () => {
  const key = await createApiKey('expiry-http-review', 'test');
  const { proc, base } = await startTestServer(process.execPath, { cwd: `${import.meta.dir}/..`, env: { ...process.env, STYX_TEST_MODE: '1' } });
  const request = (path: string) => fetch(`${base}${path}`, { method: 'POST', headers: { authorization: `Bearer ${key.key}`, 'content-type': 'application/json' }, body: JSON.stringify({ model: 'no-such-provider/no-such-model', max_tokens: 8, messages: [{ role: 'user', content: 'hello' }] }) });
  const check = async (authorized: boolean) => {
    const count = await request('/v1/messages/count_tokens');
    expect(count.status).toBe(authorized ? 200 : 401);
    const chat = await request('/v1/chat/completions');
    expect(chat.status).toBe(401);
    const body = await chat.text();
    if (authorized) expect(body).toContain('No active credentials for provider');
    else expect(body).not.toContain('No active credentials for provider');
  };
  const write = (sql: string) => {
    const p = spawnSync(process.execPath, ['-e', `const { Database } = require('bun:sqlite'); const db = new Database(process.argv[1]); db.run(process.argv[2], [process.argv[3]]); db.close();`, SQLITE_FILE!, sql, key.id], { encoding: 'utf8', env: process.env });
    expect(p.status, p.stderr).toBe(0);
  };
  try {
    await check(true);
    write("UPDATE api_keys SET expires_at = 'not-a-date' WHERE id = ?");
    await check(false);
    write('UPDATE api_keys SET expires_at = NULL WHERE id = ?');
    await check(true);
    write("UPDATE api_keys SET revoked_at = '2020-01-01', is_active = 0 WHERE id = ?");
    await check(false);
  } finally { await stopTestProcess(proc); }
}, 60000);
