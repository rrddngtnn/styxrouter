import "./helpers/test-secrets";
import { expect, test } from "bun:test";
import { createApiKey, getApiKeyMetadata } from "../src/lib/db/apiKeys";
import { SQLITE_FILE } from "../src/lib/db/core";
import { validateApiKeyRoutingTarget } from "../src/shared/utils/apiKeyPolicy";

test("quota permission changes committed by another process are visible immediately", async () => {
  const key = await createApiKey("cross-process-quota", "test");
  expect((await getApiKeyMetadata(key.key))!.allowedQuotas).toEqual([]);
  const writer = Bun.spawnSync([process.execPath, "-e", `
    const { Database } = require('bun:sqlite');
    const db = new Database(process.argv[1]);
    db.run('UPDATE api_keys SET allowed_quotas = ? WHERE id = ?', [JSON.stringify(['pool-restricted']), process.argv[2]]);
    db.close();
  `, SQLITE_FILE!, key.id], { stdout: "pipe", stderr: "pipe" });
  expect(writer.exitCode).toBe(0);
  const restricted = (await getApiKeyMetadata(key.key))!;
  expect(restricted.allowedQuotas).toEqual(["pool-restricted"]);
  expect(await validateApiKeyRoutingTarget(new Request("http://localhost"), key.key, restricted, "openai/gpt-4o")).not.toBeNull();
});
