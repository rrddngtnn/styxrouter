import "./helpers/test-secrets";
import { afterAll, afterEach, expect, test, setSystemTime } from "bun:test";
import { createApiKey, updateApiKeyPermissions } from "../src/lib/db/apiKeys.ts";
import { POST } from "../src/app/api/v1/messages/count_tokens/route.ts";

const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: POST });
afterAll(() => server.stop(true));
afterEach(() => setSystemTime());

async function setup(schedule: { enabled: boolean; from: string; until: string; days: number[]; tz: string }) {
  const key = await createApiKey("schedule-http-review", "test-machine");
  await updateApiKeyPermissions(key.id, { accessSchedule: schedule });
  return async (date: string) => {
    setSystemTime(new Date(date));
    const res = await fetch(`http://127.0.0.1:${server.port}/v1/messages/count_tokens`, {
      method: "POST",
      headers: { authorization: `Bearer ${key.key}`, "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "hello" }] }),
    });
    return res.status;
  };
}

test("invalid clock values cannot widen an overnight schedule", async () => {
  const request = await setup({ enabled: true, from: "99:00", until: "06:00", days: [1], tz: "UTC" });
  expect(await request("2026-10-27T01:00:00Z")).toBe(403);
});

test("overnight boundaries and previous-day authorization over actual HTTP", async () => {
  const request = await setup({ enabled: true, from: "22:00", until: "06:00", days: [1], tz: "UTC" });
  for (const [date, status] of [
    ["2026-10-26T01:00:00Z", 403], ["2026-10-26T21:59:59Z", 403],
    ["2026-10-26T22:00:00Z", 200], ["2026-10-27T00:00:00Z", 200],
    ["2026-10-27T05:59:59Z", 200], ["2026-10-27T06:00:00Z", 403],
    ["2026-10-27T22:00:00Z", 403],
  ] as const) expect(await request(date)).toBe(status);
});

test("DST repeated and skipped local hours use the local starting weekday", async () => {
  const request = await setup({ enabled: true, from: "22:00", until: "02:30", days: [6], tz: "America/New_York" });
  for (const [date, status] of [
    ["2026-11-01T03:00:00Z", 200], ["2026-11-01T05:30:00Z", 200],
    ["2026-11-01T06:30:00Z", 200], ["2026-11-01T07:30:00Z", 403],
    ["2026-03-08T06:59:00Z", 200], ["2026-03-08T07:00:00Z", 403],
  ] as const) expect(await request(date)).toBe(status);
});

test("equal start and end is an empty window and invalid timezone is denied", async () => {
  const same = await setup({ enabled: true, from: "00:00", until: "00:00", days: [1], tz: "UTC" });
  expect(await same("2026-10-26T00:00:00Z")).toBe(403);
  const invalid = await setup({ enabled: true, from: "22:00", until: "06:00", days: [1], tz: "Invalid/Zone" });
  expect(await invalid("2026-10-26T23:00:00Z")).toBe(403);
});
