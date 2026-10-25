/**
 * The prompt/context "token saver" (compression, Caveman, RTK, context editing) is switched off for good: whatever is
 * stored in the settings, the chat path must see it as disabled. Prompt shaping belongs to the client harness.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dataDir = mkdtempSync(join(tmpdir(), "styx-saver-"));
process.env.DATA_DIR = dataDir;
afterAll(() => rmSync(dataDir, { recursive: true, force: true }));

describe("token saver is off regardless of stored settings", () => {
  test("resolveCompressionSettings reports disabled even when the DB says enabled", async () => {
    const { updateCompressionSettings } = await import("../src/lib/db/compression.ts");
    await updateCompressionSettings({ enabled: true, defaultMode: "standard", contextEditing: { enabled: true } } as never);
    const { resolveCompressionSettings } = await import("../open-sse/handlers/chatCore/compressionSettings.ts");
    const r = await resolveCompressionSettings();
    expect(r.enabled).toBe(false);
    expect(r.contextEditingEnabled).toBe(false);
    expect(r.settings?.enabled).toBe(false);
    expect(r.settings?.defaultMode).toBe("off");
  });
});
