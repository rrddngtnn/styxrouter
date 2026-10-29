import { afterAll, beforeAll, expect, test } from "bun:test";
import { spawnSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startTestServer } from "./helpers/start-test-server";

const root = join(import.meta.dir, "..");
const dataDir = mkdtempSync(join(tmpdir(), "schedule-http-"));
const env = { ...process.env, DATA_DIR: dataDir, STYX_DATA_DIR: dataDir, STYX_TEST_MODE: "1", JWT_SECRET: "schedule-regression-jwt-secret-0123456789abcdef", API_KEY_SECRET: "schedule-regression-key-secret-0123456789abcdef" };
let proc: ChildProcess;
let base: string;
let keys: Record<string, string>;
const valid = { enabled: true, from: "00:00", until: "23:59", days: [0, 1, 2, 3, 4, 5, 6], tz: "UTC" };
const cases: Record<string, string | null> = {
  absent: null, malformed: "{bad", empty: "", jsonNull: "null", missing: JSON.stringify({ enabled: true }),
  missingEnabled: JSON.stringify({ ...valid, enabled: undefined }),
  invalidTimezone: JSON.stringify({ ...valid, tz: "Invalid/Zone" }),
  missingTimezone: JSON.stringify({ ...valid, tz: undefined }),
  invalidTime: JSON.stringify({ ...valid, from: "99:00" }),
  invalidDay: JSON.stringify({ ...valid, days: [0, 1, 2, 3, 4, 5, 6, 9] }),
  disabled: JSON.stringify({ ...valid, enabled: false }),
};
beforeAll(async () => {
  const seed = spawnSync(process.execPath, ["-e", `
    const { createApiKey, updateApiKeyPermissions } = await import('./src/lib/db/apiKeys.ts');
    const { getDbInstance } = await import('./src/lib/db/core.ts');
    const cases = JSON.parse(process.argv[1]); const keys = {};
    for (const [name, value] of Object.entries(cases)) {
      const key = await createApiKey(name, 'test'); keys[name] = key.key;
      getDbInstance().prepare('UPDATE api_keys SET access_schedule = ? WHERE id = ?').run(value, key.id);
    }
    const cleared = await createApiKey('cleared', 'test');
    await updateApiKeyPermissions(cleared.id, { accessSchedule: ${JSON.stringify(valid)} });
    await updateApiKeyPermissions(cleared.id, { accessSchedule: null }); keys.cleared = cleared.key;
    console.log('KEYS:' + JSON.stringify(keys));
  `, JSON.stringify(cases)], { cwd: root, env, encoding: "utf8" });
  if (seed.status !== 0) throw new Error(seed.stderr);
  keys = JSON.parse(seed.stdout.split('\n').find(line => line.startsWith('KEYS:'))!.slice(5));
  ({ proc, base } = await startTestServer(process.execPath, { cwd: root, env }));
}, 60000);
afterAll(async () => { if (proc) { proc.kill('SIGKILL'); await new Promise(resolve => proc.once('exit', resolve)); } rmSync(dataDir, { recursive: true, force: true }); });

async function request(path: string, key: string) {
  return fetch(base + path, { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify({ model: 'no-such-provider/no-such-model', max_tokens: 8, messages: [{ role: 'user', content: 'hello' }] }) });
}
for (const path of ['/v1/chat/completions', '/v1/messages/count_tokens']) {
  test(`${path} blocks malformed stored schedules after authentication`, async () => {
    expect((await request(path, 'invalid-key')).status).toBe(401);
    for (const name of ['malformed', 'empty', 'jsonNull', 'missing', 'missingEnabled', 'invalidTimezone', 'missingTimezone', 'invalidTime', 'invalidDay']) {
      const response = await request(path, keys[name]);
      expect([403, 503], name).toContain(response.status);
    }
  });
  test(`${path} permits absent, explicitly cleared and valid disabled schedules`, async () => {
    for (const name of ['absent', 'cleared', 'disabled']) {
      const response = await request(path, keys[name]);
      const body = await response.text();
      expect(response.status, `${name}: ${body}`).toBe(path.endsWith('count_tokens') ? 200 : 401);
      if (!path.endsWith('count_tokens')) expect(body).toContain('No active credentials for provider');
    }
  });
}
