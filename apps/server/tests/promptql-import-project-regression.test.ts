import { expect, test } from "bun:test";
import { prepareTokenImport, tokenImportProviders } from "../server/tokenImport.ts";
const part = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
const project = "12345678-1234-4123-8123-123456789012";
const jwt = `${part({alg:"none"})}.${part({iss:"enrich-token",aud:"promptql.hasura.io","https://promptql.hasura.io":{"x-hasura-project-id":project}})}.synthetic`;
test("PromptQL import requires explicit, unambiguous project binding", () => {
  const contract = tokenImportProviders().find(x => x.id === "promptql");
  expect(contract).toMatchObject({supported:true, access:true, accessRefresh:false, credentialFormat:"project-jwt"});
  const prepare = (accounts: object) => prepareTokenImport({provider:"promptql",accounts})![0].view;
  for (const account of [{access_token:jwt}, {access_token:jwt,projectId:"bad"}, {access_token:jwt,projectId:project,refresh_token:"secret"}, {auth:{access_token:jwt},credentials:{projectId:project}}]) {
    const view = prepare(account); expect(view.valid).toBe(false); expect(JSON.stringify(view)).not.toContain(jwt); expect(JSON.stringify(view)).not.toContain("secret");
  }
  for (const account of [{access_token:jwt,projectId:project}, {access_token:jwt,projectId:"12345678-1234-4123-8123-123456789013"}, {access_token:"opaque",projectId:project}]) expect(prepare(account).valid).toBe(true);
});
