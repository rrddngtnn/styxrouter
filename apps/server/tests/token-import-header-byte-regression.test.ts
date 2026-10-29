import { expect, test } from "bun:test";
import { prepareTokenImport } from "../server/tokenImport.ts";

test("rejects imported credentials that cannot be encoded as HTTP header bytes", () => {
  const result = prepareTokenImport({ provider: "openai", accounts: { token: "synthetic-🔑" } })![0].view;
  expect(result.valid).toBe(false);
  expect(JSON.stringify(result)).not.toContain("synthetic-🔑");
});
