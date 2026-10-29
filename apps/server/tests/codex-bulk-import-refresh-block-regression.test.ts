import { expect, test, mock } from "bun:test";

mock.module("@/lib/api/requireManagementAuth", () => ({ requireManagementAuth: async () => null }));

test("legacy Codex bulk import cannot rotate or persist imported credentials", async () => {
  const { POST } = await import("../src/app/api/oauth/codex/import/route.ts");
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => { calls++; return Response.json({ access_token: "rotated-access", refresh_token: "rotated-refresh" }); }) as typeof fetch;
  try {
    const response = await POST(new Request("http://localhost/api/oauth/codex/import", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ accounts: { email: "synthetic@example.test", access_token: "synthetic-access", refresh_token: "synthetic-refresh" } }),
    }));
    expect(response.status).toBe(409);
    expect((await response.text()).toLowerCase()).toContain("re-authenticate");
    expect(calls).toBe(0);
  } finally { globalThis.fetch = original; }
});
