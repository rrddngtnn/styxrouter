import "./helpers/test-secrets";
import { expect, mock, test } from "bun:test";

// Capture the filters the route forwards to getProxyLogs so we can prove a
// malformed `limit` never reaches `logs.slice(0, limit)` (which, for a negative
// value, silently drops the NEWEST N rows instead of limiting the page).
const getProxyLogs = mock((_filters: Record<string, unknown>) => []);
const clearProxyLogs = mock(() => {});
mock.module("@/lib/proxyLogger", () => ({ getProxyLogs, clearProxyLogs }));

const { GET } = await import("../src/app/api/usage/proxy-logs/route");

test("GET proxy-logs rejects malformed limit instead of forwarding garbage to slice", async () => {
  for (const query of ["limit=-2", "limit=-1", "limit=0", "limit=oops", "limit=1.9"]) {
    getProxyLogs.mockClear();
    const response = await GET(new Request(`http://localhost/api/usage/proxy-logs?${query}`));
    expect(response.status).toBe(400);
    expect(getProxyLogs).not.toHaveBeenCalled();
  }
});

test("GET proxy-logs still accepts a valid positive-integer limit", async () => {
  getProxyLogs.mockClear();
  const response = await GET(new Request("http://localhost/api/usage/proxy-logs?limit=50"));
  expect(response.status).toBe(200);
  expect(getProxyLogs).toHaveBeenCalledTimes(1);
  expect(getProxyLogs.mock.calls[0][0]).toMatchObject({ limit: 50 });
});
