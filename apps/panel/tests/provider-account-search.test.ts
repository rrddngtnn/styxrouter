import { expect, test } from "bun:test";
import { filterProviderAccounts } from "../src/lib/account-management.ts";

test("filters only displayed account names case-insensitively and retains all for an empty query", () => {
  const accounts = [{id:"alice-id", name:"Alice Sample"}, {id:"bob-id", name:"Bob Fixture"}, {id:"fallback-12345", name:null}];
  expect(filterProviderAccounts(accounts, "aLiCe").map(a => a.id)).toEqual(["alice-id"]);
  expect(filterProviderAccounts(accounts, "bob-id")).toEqual([]);
  expect(filterProviderAccounts(accounts, "fallback").map(a => a.id)).toEqual(["fallback-12345"]);
  expect(filterProviderAccounts(accounts, "no match")).toEqual([]);
  expect(filterProviderAccounts(accounts, "  ")).toEqual(accounts);
});
