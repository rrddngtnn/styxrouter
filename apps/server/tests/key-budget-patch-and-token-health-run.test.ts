import "./helpers/test-secrets";
import { expect, test } from "bun:test";
import { createAdminApi } from "../server/admin";
import { createAdminApi2 } from "../server/admin2";
import { getApiKeyById } from "../src/lib/db/apiKeys";

test("PATCH /keys/:id updates noLog, allowedConnections, usageLimitEnabled, dailyUsageLimitUsd, and weeklyUsageLimitUsd", async () => {
  const app = createAdminApi();
  const createRes = await app.request("/keys", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "budget-key" }),
  });
  expect(createRes.status).toBe(201);
  const created = (await createRes.json()) as { id: string };

  const patchRes = await app.request(`/keys/${created.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      noLog: true,
      allowedConnections: ["conn-pin-1", "conn-pin-2"],
      usageLimitEnabled: true,
      dailyUsageLimitUsd: 5.5,
      weeklyUsageLimitUsd: 25,
    }),
  });
  expect(patchRes.status).toBe(200);

  const meta = await getApiKeyById(created.id);
  expect(meta?.noLog).toBe(true);
  expect(meta?.allowedConnections).toEqual(["conn-pin-1", "conn-pin-2"]);
  expect(meta?.usageLimitEnabled).toBe(true);
  expect(meta?.dailyUsageLimitUsd).toBe(5.5);
  expect(meta?.weeklyUsageLimitUsd).toBe(25);
});

test("POST /process-health/token-scheduler/run executes an immediate token health check pass", async () => {
  const app2 = createAdminApi2();
  const res = await app2.request("/process-health/token-scheduler/run", {
    method: "POST",
  });
  expect(res.status).toBe(200);
  const data = (await res.json()) as {
    success: boolean;
    checked: number;
    refreshed: number;
  };
  expect(data.success).toBe(true);
  expect(typeof data.checked).toBe("number");
  expect(typeof data.refreshed).toBe("number");
});
