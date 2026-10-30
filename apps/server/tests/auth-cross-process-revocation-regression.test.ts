import "./helpers/test-secrets";
import { expect, test } from "bun:test";
import { createApiKey, validateApiKey, isModelAllowedForKey } from "../src/lib/db/apiKeys";
import { SQLITE_FILE } from "../src/lib/db/core";

function update(sql: string, id: string) {
  const writer = Bun.spawnSync([process.execPath, "-e", `
    const { Database } = require('bun:sqlite');
    const db = new Database(process.argv[1]);
    db.run(process.argv[2], [process.argv[3]]);
    db.close();
  `, SQLITE_FILE!, sql, id], { stdout: "pipe", stderr: "pipe" });
  expect(writer.exitCode).toBe(0);
}

test("validation observes another process revoking a previously valid key", async () => {
  const key = await createApiKey("cross-process-revocation", "test");
  expect(await validateApiKey(key.key)).toBe(true);
  update("UPDATE api_keys SET revoked_at = '2020-01-01', is_active = 0 WHERE id = ?", key.id);
  expect(await validateApiKey(key.key)).toBe(false);
});

test("model permission observes another process restricting a previously allowed key", async () => {
  const key = await createApiKey("cross-process-model", "test");
  expect(await isModelAllowedForKey(key.key, "openai/gpt-4o")).toBe(true);
  update("UPDATE api_keys SET model_access_mode = 'restricted', allowed_models = '[]' WHERE id = ?", key.id);
  expect(await isModelAllowedForKey(key.key, "openai/gpt-4o")).toBe(false);
});
