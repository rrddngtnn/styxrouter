import { test, expect } from "bun:test";
import { cline } from "../src/lib/oauth/providers/cline.ts";

// Bug: cline.mapTokens computes expiresIn via
//   tokens.expires_at ? Math.floor((new Date(expires_at) - Date.now())/1000) : 3600
// The ternary tests the PRESENCE of the string, not whether it PARSES. A
// non-empty but unparseable expires_at (e.g. a provider quirk / truncated
// field) yields `new Date(bad).getTime() === NaN` → expiresIn === NaN.
//
// Downstream, persistOAuthConnection does:
//   const expiresAt = tokenData.expiresIn ? new Date(Date.now()+expiresIn*1000) : null
// NaN is falsy, so expiresAt persists as null → the connection is treated as
// NEVER-EXPIRING. The token is never refreshed and a dead access token keeps
// getting dispatched. Every sibling provider guards this (zai-glm Number.isFinite,
// grok Math.max(1,…), codexImport Number.isFinite). Cline does not.
//
// Correct behavior: a malformed expires_at must fall back to the SAME
// conservative default a missing expires_at uses (3600s), never NaN.

test("cline.mapTokens falls back to default TTL when expires_at is unparseable", () => {
  const m = cline.mapTokens({
    access_token: "a",
    refresh_token: "r",
    expires_at: "not-a-real-date",
    email: "e@example.com",
  });
  expect(Number.isNaN(m.expiresIn as number)).toBe(false);
  expect(m.expiresIn).toBe(3600);
});

test("cline.mapTokens keeps a valid ISO expires_at as a real positive TTL", () => {
  const future = new Date(Date.now() + 3600_000).toISOString();
  const m = cline.mapTokens({
    access_token: "a",
    refresh_token: "r",
    expires_at: future,
    email: "e@example.com",
  });
  // ~3600s (allow a couple seconds of execution slack)
  expect(m.expiresIn as number).toBeGreaterThan(3590);
  expect(m.expiresIn as number).toBeLessThanOrEqual(3600);
});

test("cline.mapTokens falls back to default TTL when expires_at is absent", () => {
  const m = cline.mapTokens({
    access_token: "a",
    refresh_token: "r",
    email: "e@example.com",
  });
  expect(m.expiresIn).toBe(3600);
});
