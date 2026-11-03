import "./helpers/test-secrets";
import { expect, mock, test } from "bun:test";
import { createProviderConnection, getProviderConnectionById } from "../src/lib/db/providers";

let failure: "throw" | "code" = "throw";
// Only the network-facing seam is replaced; exercise actual HTTP/DB/audit handling.
mock.module("../src/sse/services/tokenRefresh.ts", () => ({
  getAccessToken: async () => {
    if (failure === "throw") throw new Error("refresh_token=fixture-private-token proxy=http://user:private@host");
    return { code: "fixture-private-token", error: "invalid" };
  },
  updateProviderCredentials: async () => true,
}));
const { createAdminApi } = await import("../server/admin");
const app = createAdminApi();
for (const mode of ["throw", "code"] as const) {
  test(`${mode} refresh errors never echo upstream secrets into response or health state`, async () => {
    failure = mode;
    const conn = await createProviderConnection({ provider: "codex", authType: "oauth", accessToken: "old", refreshToken: "fixture-refresh", name: mode });
    const response = await app.request(`/connections/${conn.id}/refresh-token`, { method: "POST" });
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain("fixture-private-token");
    expect((await getProviderConnectionById(conn.id))?.lastError ?? "").not.toContain("fixture-private-token");
  });
}
