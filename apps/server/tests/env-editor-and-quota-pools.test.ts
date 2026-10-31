import "./helpers/test-secrets";
import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyEnvUpdatesToFile,
  parseMaskedEnvFile,
  validateEnvUpdates,
} from "../server/envEditor";

test("validateEnvUpdates allows allowlisted keys with balanced values and rejects unknown keys or multiline injection", () => {
  expect(
    validateEnvUpdates({
      PORT: "20128",
      STYX_BACKUP_KEEP: "14",
      STYX_ANTIGRAVITY_CLIENT_PROFILE: "hub",
    }),
  ).toEqual({ ok: true });

  const unknown = validateEnvUpdates({ LD_PRELOAD: "/tmp/evil.so" });
  expect(unknown.ok).toBe(false);

  const multiline = validateEnvUpdates({ PORT: "20128\nEVIL=1" });
  expect(multiline.ok).toBe(false);

  const unbalanced = validateEnvUpdates({ STYX_ANTIGRAVITY_CLIENT_PROFILE: '"unclosed' });
  expect(unbalanced.ok).toBe(false);
});

test("parseMaskedEnvFile masks secrets and applyEnvUpdatesToFile writes backup before updating allowlisted keys", () => {
  const dir = mkdtempSync(join(tmpdir(), "styx-env-test-"));
  try {
    const envPath = join(dir, ".env");
    writeFileSync(
      envPath,
      [
        "PORT=20128",
        "JWT_SECRET=super-secret-jwt-value",
        "STORAGE_ENCRYPTION_KEY=0123456789abcdef0123456789abcdef",
        "STYX_ANTIGRAVITY_CLIENT_PROFILE=ide",
      ].join("\n") + "\n",
      { mode: 0o600 },
    );

    const parsed = parseMaskedEnvFile(envPath);
    const jwtEntry = parsed.find((e) => e.key === "JWT_SECRET");
    expect(jwtEntry?.masked).toBe(true);
    expect(jwtEntry?.value).toBe("[MASKED]");
    expect(JSON.stringify(parsed)).not.toContain("super-secret-jwt-value");

    const updated = applyEnvUpdatesToFile(envPath, {
      STYX_ANTIGRAVITY_CLIENT_PROFILE: "hub",
      STYX_BACKUP_KEEP: "10",
    });
    expect(updated.backupPath).toBe(`${envPath}.bak`);
    expect(readFileSync(`${envPath}.bak`, "utf8")).toContain("STYX_ANTIGRAVITY_CLIENT_PROFILE=ide");

    const afterText = readFileSync(envPath, "utf8");
    expect(afterText).toContain("STYX_ANTIGRAVITY_CLIENT_PROFILE=hub");
    expect(afterText).toContain("STYX_BACKUP_KEEP=10");
    expect(afterText).toContain("JWT_SECRET=super-secret-jwt-value");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
