import { expect, test } from "bun:test";
process.env.STORAGE_ENCRYPTION_KEY = "synthetic-independent-review-key";
process.env.STYX_TEST_MODE = "1";
const { prepareTokenImport } = await import("../server/tokenImport.ts");
const prep = (account: unknown) => prepareTokenImport({ provider: "codebuddy-cn", accounts: account })![0].view;

test("relative expiry with an explicit issuance timestamp is anchored to issuance, not import time", () => {
  expect(prep({ token: "synthetic-token", issued_at: 1700000000, expires_in: 3600 })).toMatchObject({ valid: true, expiresAt: "2023-11-14T23:13:20.000Z" });
});

test("identical tokens in separate sibling credential branches are ambiguous", () => {
  expect(prep({ auth: { token: "synthetic-token" }, credentials: { token: "synthetic-token" } }).valid).toBe(false);
});

test("expiry in a sibling branch cannot be attached to a credential", () => {
  expect(prep({ auth: { token: "synthetic-token" }, credentials: { expires_at: 1700000000 } }).valid).toBe(false);
});

test("relative expiry requires valid bounded and related issuance", () => {
  for (const account of [
    { token: "synthetic-token", expires_in: 1 },
    { token: "synthetic-token", issued_at: 1700000000, expires_in: -1 },
    { token: "synthetic-token", issued_at: 1700000000, expires_in: 1e100 },
    { auth: { token: "synthetic-token", expires_in: 5 }, credentials: { issued_at: 1700000000 } },
  ]) expect(prep(account).valid).toBe(false);
  expect(String(prep({ token: "synthetic-token", expires_in: 1 }).error)).toContain("Relative expiry");
});

test("earliest expiry wins for anchored relative, absolute and JWT claims", () => {
  const jwt = `e30.${Buffer.from(JSON.stringify({ exp: 1700000010 })).toString("base64url")}.sig`;
  expect(prep({ token: jwt, issued_at: 1700000000, expires_in: 20, expires_at: 1700000030 }).expiresAt).toBe("2023-11-14T22:13:30.000Z");
});

test("sibling provider and expiry evidence is ambiguous even with a parent token", () => {
  expect(prep({ token: "synthetic-token", auth: { provider: "codebuddy-cn" }, credentials: { expires_at: 1700000000 } }).valid).toBe(false);
});

test("invalid JWT expiry is rejected even when absolute expiry exists", () => {
  const jwt = `e30.${Buffer.from(JSON.stringify({ exp: "1700000010" })).toString("base64url")}.sig`;
  expect(prep({ token: jwt, expires_at: 1700000030 }).valid).toBe(false);
});
