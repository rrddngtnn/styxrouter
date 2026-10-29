import { expect, test } from "bun:test";
import { createProcessHealthApi } from "../server/processHealth.ts";

test("process CPU health reports cumulative process CPU time without caching", async () => {
  const before = process.cpuUsage();
  const response = await createProcessHealthApi().request("/cpu");
  const after = process.cpuUsage();
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const body = await response.json() as { userMicroseconds: number; systemMicroseconds: number };
  expect(Object.keys(body).sort()).toEqual(["systemMicroseconds", "userMicroseconds"]);
  for (const [field, key] of [["userMicroseconds", "user"], ["systemMicroseconds", "system"]] as const) {
    expect(Number.isSafeInteger(body[field])).toBe(true);
    expect(body[field]).toBeGreaterThanOrEqual(before[key]);
    expect(body[field]).toBeLessThanOrEqual(after[key]);
  }
});
