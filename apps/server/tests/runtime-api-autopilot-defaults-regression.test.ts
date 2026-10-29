import { expect, mock, test } from "bun:test";

let received: unknown;
mock.module("@/lib/api/requireManagementAuth", () => ({ requireManagementAuth: async () => null }));
mock.module("@/lib/monitoring/comboHealthAutopilot", () => ({
  buildComboHealthAutopilotReport: async (options: unknown) => {
    received = options;
    return { summary: { comboCount: 1 } };
  },
}));
const { GET } = await import("../src/app/api/usage/combo-health-autopilot/route");

test("autopilot defaults and explicit flags are booleans", async () => {
  expect((await GET(new Request("http://localhost/api/usage/combo-health-autopilot"))).status).toBe(200);
  expect(received).toMatchObject({ includeHealthy: false, includeActions: true });
  expect((await GET(new Request("http://localhost/api/usage/combo-health-autopilot?includeHealthy=true&includeActions=false"))).status).toBe(200);
  expect(received).toMatchObject({ includeHealthy: true, includeActions: false });
  expect((await GET(new Request("http://localhost/api/usage/combo-health-autopilot?includeHealthy=invalid"))).status).toBe(400);
});
