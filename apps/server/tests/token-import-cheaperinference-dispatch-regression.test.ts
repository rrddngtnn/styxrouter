import { expect, test } from "bun:test";

process.env.STORAGE_ENCRYPTION_KEY = "synthetic-cheaper-encryption-key";

test("compatibility matrix", async () => {
  const { tokenImportProviders } = await import("../server/tokenImport.ts");
  const entries = tokenImportProviders();
  for (const mode of ["oauth", "apikey", "unsupported"]) console.log(`MATRIX ${mode}: ${entries.filter((e: any) => (e.authType ?? "unsupported") === mode).map((e: any) => e.id).join(", ")}`);
  expect(entries.find((e: any) => e.id === "cheaperinference")).toMatchObject({ supported: true, access: true, accessRefresh: false, json: true });
});

test("cheaperinference imported API key dispatches to its own upstream", async () => {
  const { prepareTokenImport, saveTokenImport } = await import("../server/tokenImport.ts");
  const { getProviderCredentials } = await import("../src/sse/services/auth.ts");
  const { getExecutor } = await import("../open-sse/executors/index.ts");
  const entries = prepareTokenImport({ provider: "cheaperinference", accounts: { token: "synthetic-cheaper-key" } })!;
  const imported: any = (await saveTokenImport(entries))[0];
  expect(imported.valid).toBe(true);
  const credentials = await getProviderCredentials("cheaperinference", null, [imported.id]);
  const original = globalThis.fetch;
  const calls: { url: string; authorization: string | null }[] = [];
  globalThis.fetch = (async (url: any, options: any) => {
    calls.push({ url: String(url), authorization: new Headers(options.headers).get("authorization") });
    return Response.json({ id: "synthetic", choices: [] });
  }) as typeof fetch;
  try {
    const result = await getExecutor("cheaperinference").execute({ model: "synthetic-model", body: { messages: [{ role: "user", content: "test" }] }, stream: false, credentials });
    expect(result.response.status).toBe(200);
    expect(calls).toEqual([{ url: "https://api.cheaperinference.com/v1/chat/completions", authorization: "Bearer synthetic-cheaper-key" }]);
  } finally { globalThis.fetch = original; }
}, 30000);
