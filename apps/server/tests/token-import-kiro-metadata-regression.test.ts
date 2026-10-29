import { expect, test } from "bun:test";
import { prepareTokenImport, tokenImportProviders } from "../server/tokenImport.ts";

test("Kiro social and external IdP imports require valid bounded metadata and reject unsupported methods", () => {
  expect(tokenImportProviders().find(e => e.id === "kiro")?.supported).toBe(true);
  const prepare = (account: object) => prepareTokenImport({ provider: "kiro", accounts: account })![0];
  const arn = "arn:aws:codewhisperer:eu-central-1:123456789012:profile/abcdef12-3456-7890-abcd-123456789012";
  expect(prepare({ access_token: "synthetic-access", authMethod: "external_idp", profileArn: arn, region: "eu-north-1" }).view.valid).toBe(true);
  expect(prepare({ access_token: "synthetic-access", authMethod: "social" }).view.valid).toBe(true);
  for (const metadata of [{}, {authMethod:"api_key"}, {authMethod:"external_idp"}, {authMethod:"social", region:"evil.example"}, {authMethod:"social", profileArn:"synthetic-secret"}]) {
    const result = prepare({access_token:"synthetic-access", ...metadata});
    expect(result.view.valid).toBe(false);
    expect(JSON.stringify(result.view)).not.toContain("synthetic-");
  }
});
