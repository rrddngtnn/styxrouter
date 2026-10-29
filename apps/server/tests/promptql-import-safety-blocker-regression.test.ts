import { expect, test } from "bun:test";
import { PromptQlExecutor } from "../open-sse/executors/promptql.ts";
import { prepareTokenImport } from "../server/tokenImport.ts";

const part = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
const jwt = `${part({alg:"none"})}.${part({iss:"enrich-token",aud:"promptql.hasura.io","https://promptql.hasura.io":{"x-hasura-project-id":"12345678-1234-4123-8123-123456789012"}})}.synthetic-signature`;

test("PromptQL import remains blocked and executor redacts credential-bearing upstream errors", async () => {
  const preview = prepareTokenImport({provider:"promptql",accounts:{access_token:jwt}})![0].view;
  expect(preview.valid).toBe(false);
  expect(JSON.stringify(preview)).not.toContain(jwt);
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => { calls++; return new Response(`synthetic-upstream-secret ${jwt}`, {status:401}); }) as typeof fetch;
  try {
    const result = await new PromptQlExecutor().execute({model:"synthetic-model",body:{messages:[{role:"user",content:"hello"}]},stream:false,credentials:{apiKey:jwt}} as any);
    const text = await result.response.text();
    expect(calls).toBeGreaterThan(0);
    expect(text).not.toContain(jwt);
    expect(text).not.toContain("synthetic-upstream-secret");
  } finally { globalThis.fetch = original; }
});
