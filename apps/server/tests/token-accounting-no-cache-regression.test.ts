import { expect, test } from "bun:test";
import { getNoCacheTokens } from "../src/lib/usage/tokenAccounting";

test("recognizes top-level noCacheTokens without losing missing-versus-zero semantics", () => {
  expect(getNoCacheTokens({ noCacheTokens: 42 })).toBe(42);
  expect(getNoCacheTokens({ noCacheTokens: 0 })).toBe(0);
  expect(getNoCacheTokens({})).toBeNull();
});
