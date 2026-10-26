import { expect, test } from "bun:test";
import * as helpers from "../src/components/settings/advanced-settings-helpers.ts";

test("sanitizes sensitive keys recursively without mutating configuration", () => {
  expect(helpers).toHaveProperty("sanitizeSettings");
  const input = {
    strategy: "priority", maxTokens: 4096, requireApiKey: true,
    apiKey: "top-secret", passwordHash: "hash", STORAGE_ENCRYPTION_KEY: "encryption",
    providers: [{ name: "demo", access_token: "access", nested: { clientSecret: "client", authorization: "Bearer secret", cookie: "session" } }],
    credentials: { username: "operator", password: "hidden" },
  };
  const sanitized = helpers.sanitizeSettings(input);
  expect(sanitized).toEqual({
    strategy: "priority", maxTokens: 4096, requireApiKey: true,
    apiKey: "[REDACTED]", passwordHash: "[REDACTED]", STORAGE_ENCRYPTION_KEY: "[REDACTED]",
    providers: [{ name: "demo", access_token: "[REDACTED]", nested: { clientSecret: "[REDACTED]", authorization: "[REDACTED]", cookie: "[REDACTED]" } }],
    credentials: "[REDACTED]",
  });
  expect(input.apiKey).toBe("top-secret");
  expect(input.providers[0]?.access_token).toBe("access");
});

test("redacts token variants and secrets embedded in URL, bearer, and encrypted values", () => {
  const sanitized = helpers.sanitizeSettings({
    authToken: "auth", sessionKey: "session", api_keys: ["a", "b"],
    endpoint: "https://user:password@example.test/v1?api_key=secret&mode=fast",
    nested: ["Bearer abc.def", "enc:v1:123:456:789"],
    tokenLimit: 100, tokenRefreshInterval: 60, keybindings: "default", enabled: false, unset: null,
  });
  expect(sanitized).toEqual({
    authToken: "[REDACTED]", sessionKey: "[REDACTED]", api_keys: "[REDACTED]",
    endpoint: "[REDACTED]", nested: ["[REDACTED]", "[REDACTED]"],
    tokenLimit: 100, tokenRefreshInterval: 60, keybindings: "default", enabled: false, unset: null,
  });
});

test("filters case-insensitive nested key paths, not values, retaining ancestors and array positions", () => {
  expect(helpers).toHaveProperty("filterSettings");
  const settings = helpers.sanitizeSettings({
    strategy: "priority", providers: [{ name: "one", timeoutMs: 200 }, { name: "two", timeoutMs: 300 }],
    nested: { retryCount: 2, enabled: true },
  });
  expect(helpers.filterSettings(settings, " TIMEOUT ")).toEqual({ providers: [{ timeoutMs: 200 }, { timeoutMs: 300 }] });
  expect(helpers.filterSettings(settings, "nested")).toEqual({ nested: { retryCount: 2, enabled: true } });
  expect(helpers.filterSettings(settings, "nested.retry")).toEqual({ nested: { retryCount: 2 } });
  expect(helpers.filterSettings(settings, "providers.1.name")).toEqual({ providers: [null, { name: "two" }] });
  expect(helpers.filterSettings(settings, "priority")).toEqual({});
  expect(helpers.filterSettings(settings, " ")).toEqual(settings);
});

test("local migration is enabled only on explicit direct loopback hosts", () => {
  expect(helpers).toHaveProperty("isMigrationLoopback");
  for (const host of ["localhost", "127.0.0.1"]) expect(helpers.isMigrationLoopback(host)).toBe(true);
  for (const host of ["", "panel.example.com", "localhost.example.com", "192.168.1.2", "0.0.0.0", "127.0.0.2", "[::1]"]) {
    expect(helpers.isMigrationLoopback(host)).toBe(false);
  }
});

test("migration summaries require the server's actual counts, backup and matching run mode", () => {
  expect(helpers).toHaveProperty("parseMigrationResult");
  const result = { migrated: 2, failed: 1, skipped: 3, backup: null, dryRun: true };
  expect(helpers.parseMigrationResult(result, true)).toEqual(result);
  expect(helpers.parseMigrationResult({ ...result, backup: "/db.sqlite.pre-styx-backup", dryRun: false }, false).backup).toBe("/db.sqlite.pre-styx-backup");
  for (const invalid of [null, {}, { ...result, failed: undefined }, { ...result, migrated: -1 }, { ...result, skipped: "3" }, { ...result, dryRun: false }]) {
    expect(() => helpers.parseMigrationResult(invalid, true)).toThrow("Invalid migration response");
  }
  expect(() => helpers.parseMigrationResult({ ...result, dryRun: false }, false)).toThrow("Invalid migration response");
});
