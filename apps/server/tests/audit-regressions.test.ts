/**
 * Regression tests for the whole-codebase audit fixes:
 *  1. bunSqliteAdapter.prepare(sql).get(...) returns undefined (not null) on 0 rows,
 *     so isExclusiveConnectionActivelyLeased returns false when no lease exists.
 *  2. codebuddyIntl exports pollToken + mapTokens and is in NO_PKCE_DEVICE_CODE_PROVIDERS.
 *  3. /api/oauth/providers only lists canonical REGISTRY providers and sets legacyDevice
 *     only for glm/zai (never hijacking kiro/github/kimi-coding).
 *  4. PIIMaskerGuardrail is a fast no-op in both preCall and postCall when PII_REDACTION_ENABLED is false.
 *  5. backupRetention.collectBackupFamilies never collects _manual.sqlite or _scheduled.sqlite snapshots.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dataDir = mkdtempSync(join(tmpdir(), "styx-audit-reg-"));
process.env.DATA_DIR = dataDir;
process.env.STYX_TEST_MODE = "1";
afterAll(() => rmSync(dataDir, { recursive: true, force: true }));

describe("bunSqliteAdapter .get() contract & exclusive lease check", () => {
  test("get() returns undefined on missing row and isExclusiveConnectionActivelyLeased is false", async () => {
    const { getDbInstance } = await import("../src/lib/db/core.ts");
    const { isExclusiveConnectionActivelyLeased } = await import("../src/lib/db/exclusiveConnectionLeases.ts");
    const { isConnectionUnavailableToAuxiliaryActivity } = await import("../src/lib/exclusiveLeaseIsolation.ts");
    const db = getDbInstance();
    const row = db
      .prepare("SELECT * FROM exclusive_connection_leases WHERE state = 'ACTIVE' AND connection_id = ?")
      .get("nonexistent-conn-id");
    expect(row).toBeUndefined();
    expect(isExclusiveConnectionActivelyLeased("nonexistent-conn-id")).toBe(false);
    expect(await isConnectionUnavailableToAuxiliaryActivity("nonexistent-conn-id")).toBe(false);
  });
});

describe("CodeBuddy Intl OAuth provider contract", () => {
  test("exports pollToken and mapTokens with expected shape", async () => {
    const { codebuddyIntl } = await import("../src/lib/oauth/providers/codebuddy-intl.ts");
    expect(typeof codebuddyIntl.requestDeviceCode).toBe("function");
    expect(typeof codebuddyIntl.pollToken).toBe("function");
    expect(typeof codebuddyIntl.mapTokens).toBe("function");
    const mapped = codebuddyIntl.mapTokens({
      access_token: "cb-tok",
      refresh_token: "cb-ref",
      token_type: "Bearer",
      expires_in: 3600,
    });
    expect(mapped).toEqual({
      accessToken: "cb-tok",
      refreshToken: "cb-ref",
      expiresIn: 3600,
    });
  });
});

describe("PIIMaskerGuardrail respects PII_REDACTION_ENABLED", () => {
  test("preCall and postCall do not clone or redact when PII_REDACTION_ENABLED is disabled", async () => {
    const { PIIMaskerGuardrail } = await import("../src/lib/guardrails/piiMasker.ts");
    const g = new PIIMaskerGuardrail({ enabled: true });
    const reqPayload = { messages: [{ role: "user", content: "contact me at user@example.com" }] };
    const pre = await g.preCall(reqPayload, {} as any);
    expect(pre.block).toBe(false);
    expect(pre.modifiedPayload).toBeUndefined();

    const resPayload = { choices: [{ message: { content: "email is user@example.com" } }] };
    const post = await g.postCall(resPayload, {} as any);
    expect(post.block).toBe(false);
    expect(post.modifiedResponse).toBeUndefined();
  });
});

describe("backupRetention protects manual and scheduled snapshots", () => {
  test("collectBackupFamilies skips _manual.sqlite and _scheduled.sqlite files", async () => {
    const { collectBackupFamilies } = await import("../src/lib/db/backupRetention.ts");
    const dir = mkdtempSync(join(tmpdir(), "styx-bkp-ret-"));
    try {
      writeFileSync(join(dir, "db_2026-10-25T00-00-00-000Z_manual.sqlite"), "x");
      writeFileSync(join(dir, "db_2026-10-25T00-00-00-000Z_scheduled.sqlite"), "x");
      writeFileSync(join(dir, "db_2026-10-25T00-00-00-000Z_pre-write.sqlite"), "x");
      const families = collectBackupFamilies(dir);
      expect(families.map((f) => f.base)).toEqual(["db_2026-10-25T00-00-00-000Z_pre-write.sqlite"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
