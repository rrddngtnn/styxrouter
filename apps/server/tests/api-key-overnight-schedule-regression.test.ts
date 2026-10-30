import "./helpers/test-secrets";
import { afterEach, expect, test, setSystemTime } from "bun:test";
import { createApiKey, updateApiKeyPermissions } from "../src/lib/db/apiKeys.ts";
import { enforceApiKeyPolicy } from "../src/shared/utils/apiKeyPolicy.ts";

afterEach(() => setSystemTime());

test("overnight schedule associates the after-midnight segment with its starting day", async () => {
  const key = await createApiKey("overnight-schedule", "test-machine");
  await updateApiKeyPermissions(key.id, { accessSchedule: { enabled: true, from: "22:00", until: "06:00", days: [1], tz: "UTC" } });
  const request = new Request("http://localhost/v1/chat/completions", { headers: { authorization: `Bearer ${key.key}` } });
  setSystemTime(new Date("2026-10-26T01:00:00Z")); // Monday, but Sunday is not allowed
  expect((await enforceApiKeyPolicy(request, null)).rejection?.status).toBe(403);
  setSystemTime(new Date("2026-10-26T23:00:00Z")); // Monday night
  expect((await enforceApiKeyPolicy(request, null)).rejection).toBeNull();
  setSystemTime(new Date("2026-10-27T01:00:00Z")); // continuation of Monday night
  expect((await enforceApiKeyPolicy(request, null)).rejection).toBeNull();
});
