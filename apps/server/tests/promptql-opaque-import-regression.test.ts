import { expect, test } from "bun:test";
import { prepareTokenImport } from "../server/tokenImport.ts";
import { PromptQlExecutor } from "../open-sse/executors/promptql.ts";

const project = "12345678-1234-4123-8123-123456789012";
const encode = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
const token = `${encode({alg:"none"})}.${encode({exp:1,aud:"12345678-1234-4123-8123-123456789013"})}.synthetic`;

test("import uses explicit project binding and does not trust JWT claims", () => {
  const item = prepareTokenImport({provider:"promptql",accounts:{access_token:token,projectId:project}})![0];
  expect(item.view.valid).toBe(true);
  expect(item.view.expiresAt).toBeNull();
  expect(item.promptqlProjectId).toBe(project);
  expect(JSON.stringify(item.view)).not.toContain(token);
});

test("import rejects missing, invalid, conflicting or sibling project bindings", () => {
  const inputs = [
    {access_token:token},
    {access_token:token,projectId:"bad"},
    {access_token:token,projectId:project,project_id:"12345678-1234-4123-8123-123456789013"},
    {auth:{access_token:token},credentials:{projectId:project}},
    {access_token:token,projectId:project,refresh_token:"synthetic-refresh"},
  ];
  for (const accounts of inputs) {
    const view = prepareTokenImport({provider:"promptql",accounts})![0].view;
    expect(view.valid).toBe(false);
    expect(JSON.stringify(view)).not.toContain(token);
    expect(JSON.stringify(view)).not.toContain("synthetic-refresh");
  }
});

test("imported dispatch ignores JWT claims and transmits explicit project", async () => {
  const original = globalThis.fetch;
  const requests: any[] = [];
  globalThis.fetch = (async (input, init) => {
    const req = new Request(input, init);
    requests.push({authorization:req.headers.get("authorization"),body:await req.json()});
    return new Response(`upstream-secret ${token}`, {status:403});
  }) as typeof fetch;
  try {
    const result = await new PromptQlExecutor().execute({model:"synthetic",body:{messages:[{role:"user",content:"hello"}]},stream:false,credentials:{accessToken:token,providerSpecificData:{projectId:project,importedToken:true,nonRefreshable:true}}} as any);
    expect(result.response.status).toBe(403);
    expect(requests).toHaveLength(1);
    expect(requests[0].authorization).toBe(`Bearer ${token}`);
    expect(requests[0].body.variables.projectId).toBe(project);
    expect(await result.response.text()).not.toContain(token);
  } finally { globalThis.fetch = original; }
});
