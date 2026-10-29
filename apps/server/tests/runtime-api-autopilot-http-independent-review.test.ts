import { expect, mock, test } from "bun:test";

let received: unknown;
mock.module("@/lib/api/requireManagementAuth", () => ({ requireManagementAuth: async () => null }));
mock.module("@/lib/monitoring/comboHealthAutopilot", () => ({
  buildComboHealthAutopilotReport: async (options: unknown) => {
    received = options;
    return { summary: { comboCount: 1 }, options };
  },
}));
const { GET } = await import("../src/app/api/usage/combo-health-autopilot/route");

test("autopilot flags over actual HTTP", async () => {
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: GET });
  try {
    const url = `http://127.0.0.1:${server.port}/api/usage/combo-health-autopilot`;
    for (const [query, healthy, actions] of [
      ["", false, true],
      ["?includeHealthy=true&includeActions=false", true, false],
      ["?includeHealthy=false&includeActions=true", false, true],
      ["?includeHealthy=true", true, true],
      ["?includeActions=false", false, false],
    ] as const) {
      const response = await fetch(url + query);
      expect(response.status).toBe(200);
      expect(received).toMatchObject({ includeHealthy: healthy, includeActions: actions });
      expect((await response.json()).options).toMatchObject({ includeHealthy: healthy, includeActions: actions });
    }
    for (const query of ["?includeHealthy=invalid", "?includeActions=invalid", "?includeHealthy=1", "?includeActions=null"]) {
      received = undefined;
      const response = await fetch(url + query);
      expect(response.status).toBe(400);
      expect(received).toBeUndefined();
    }
    for (const query of ["?includeHealthy=", "?includeActions="]) {
      const response = await fetch(url + query);
      expect(response.status).toBe(400);
    }
  } finally {
    server.stop(true);
  }
});
