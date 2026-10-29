import { expect, test } from "bun:test";
import { createProviderConnection } from "../src/lib/db/providers";
import { getUnifiedModelsResponse, __resetCatalogBuilderRunsForTest, __getCatalogBuilderRunsForTest } from "../src/app/api/v1/models/catalog";

const id = "gpt-6.1-terra";
async function window() {
  const response = await getUnifiedModelsResponse(new Request("http://localhost/v1/models"));
  expect(response.status).toBe(200);
  const body = await response.json() as { data: { id: string; context_length?: number }[] };
  return body.data.find(x => x.id === `codex/${id}`)?.context_length;
}
test("a different process syncing Codex invalidates a primed real catalog", async () => {
  const c = await createProviderConnection({ provider: "codex", authType: "oauth", accessToken: "fixture", isActive: true, name: "catalog revision" } as any);
  __resetCatalogBuilderRunsForTest();
  const before = await window();
  expect(await window()).toBe(before);
  expect(__getCatalogBuilderRunsForTest()).toBe(1);
  const worker = Bun.spawn([process.execPath, new URL("./helpers/codex-context-cache-worker.ts", import.meta.url).pathname, c.id], { env: process.env, stdout: "pipe", stderr: "pipe" });
  const stdout = await new Response(worker.stdout).text();
  const stderr = await new Response(worker.stderr).text();
  expect(await worker.exited).toBe(0);
  expect(stdout).toContain("SYNC_STATUS=200");
  expect(stderr).not.toContain("error:");
  expect(await window()).toBe(1000000);
  const { getModelContextOverrideRecord } = await import("../src/lib/db/modelContextOverrides");
  expect(getModelContextOverrideRecord("codex", id)?.realContext).toBe(234567);
  expect(__getCatalogBuilderRunsForTest()).toBe(2);
});
