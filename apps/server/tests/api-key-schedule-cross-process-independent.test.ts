import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createApiKey } from "../src/lib/db/apiKeys";
import { SQLITE_FILE } from "../src/lib/db/core";
import { startTestServer } from "./helpers/start-test-server";
import { stopTestProcess } from "./helpers/stop-test-process";

test("authenticated HTTP observes another process corrupting and clearing a primed schedule", async () => {
  const key = await createApiKey("schedule-cross-process-review", "test");
  const { proc, base } = await startTestServer(process.execPath, { cwd: `${import.meta.dir}/..`, env: { ...process.env, STYX_TEST_MODE: "1" } });
  const request = () => fetch(`${base}/v1/messages/count_tokens`, { method: "POST", headers: { authorization: `Bearer ${key.key}`, "content-type": "application/json" }, body: JSON.stringify({ messages: [{ role: "user", content: "hello" }] }) });
  const write = (value: string | null) => {
    const p = spawnSync(process.execPath, ["-e", `const { Database } = require('bun:sqlite'); const db = new Database(process.argv[1]); db.run('UPDATE api_keys SET access_schedule = ? WHERE id = ?', [JSON.parse(process.argv[2]), process.argv[3]]); db.close();`, SQLITE_FILE!, JSON.stringify(value), key.id], { encoding: "utf8", env: process.env });
    expect(p.status, p.stderr).toBe(0);
  };
  try {
    expect((await request()).status).toBe(200);
    write('{broken');
    expect([403, 503]).toContain((await request()).status);
    write(JSON.stringify({ enabled: false, from: '99:00', until: '06:00', days: [1], tz: 'UTC' }));
    expect([403, 503]).toContain((await request()).status);
    write(null);
    expect((await request()).status).toBe(200);
  } finally { await stopTestProcess(proc); }
}, 60000);
