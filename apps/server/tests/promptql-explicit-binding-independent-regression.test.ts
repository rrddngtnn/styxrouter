import { expect, test } from "bun:test";
import { PromptQlExecutor } from "../open-sse/executors/promptql.ts";
import { prepareTokenImport } from "../server/tokenImport.ts";

const part = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
const explicit = "12345678-1234-4123-8123-123456789012";
const forged = "12345678-1234-4123-8123-123456789013";
const jwt = `${part({alg:"none"})}.${part({iss:"enrich-token",aud:"promptql.hasura.io","https://promptql.hasura.io":{"x-hasura-project-id":forged}})}.synthetic`;

test("executor passes explicit project rather than unsigned JWT claim and upstream rejects", async () => {
  const original = globalThis.fetch;
  const requests: {authorization: string | null; body: any}[] = [];
  globalThis.fetch = (async (input, init) => {
    const req = new Request(input, init);
    requests.push({authorization: req.headers.get("authorization"), body: await req.json()});
    return new Response("synthetic secret", {status: 401});
  }) as typeof fetch;
  try {
    const result = await new PromptQlExecutor().execute({model:"claude-sonnet-4",body:{messages:[{role:"user",content:"hello"}]},stream:false,credentials:{accessToken:jwt,providerSpecificData:{projectId:explicit,importedToken:true,nonRefreshable:true}}} as any);
    expect(result.response.status).toBe(401);
    expect(requests).toHaveLength(1);
    expect(requests[0].authorization).toBe(`Bearer ${jwt}`);
    expect(requests[0].body.variables.projectId).toBe(explicit);
    expect(await result.response.text()).not.toContain("synthetic secret");
  } finally { globalThis.fetch = original; }
});

test("project import accepts explicit binding independent of claims", () => {
  const result = prepareTokenImport({provider:"promptql",accounts:{access_token:jwt,projectId:explicit}})![0].view;
  expect(result.valid).toBe(true);
  expect(JSON.stringify(result)).not.toContain(jwt);
});
