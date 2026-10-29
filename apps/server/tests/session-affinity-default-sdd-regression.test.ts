import { describe, expect, test } from "bun:test";
import { getSettings, updateSettings } from "../src/lib/db/settings";
import { resolveSessionAffinityTtlMs, selectSessionAffinityConnection } from "../src/sse/services/sessionAffinityPin";
import { extractSessionAffinityKey } from "../src/sse/services/auth";

describe("session affinity defaults", () => {
  test("honors headers, keeps the chosen account, and fails over when unavailable", async () => {
    const key = extractSessionAffinityKey({}, new Headers({ "X-Session-ID": "client-123" }));
    expect(key).toBeTruthy();
    const ttl = resolveSessionAffinityTtlMs("example", {}, await getSettings());
    const first = { id: "test-a", priority: 1 };
    const second = { id: "test-b", priority: 2 };
    expect((await selectSessionAffinityConnection("example", key, [first, second], ttl))?.id).toBe("test-a");
    expect((await selectSessionAffinityConnection("example", key, [second, first], ttl))?.id).toBe("test-a");
    expect((await selectSessionAffinityConnection("example", key, [second], ttl))?.id).toBe("test-b");
    expect((await selectSessionAffinityConnection("example", key, [first, second], ttl))?.id).toBe("test-b");
  });
  test("defaults to thirty minutes while preserving an explicit zero", async () => {
    const settings = await getSettings();
    expect(settings.sessionAffinityTtlMs).toBe(1_800_000);
    expect(resolveSessionAffinityTtlMs("test", {}, settings)).toBe(1_800_000);
    await updateSettings({ sessionAffinityTtlMs: 0 });
    const disabled = await getSettings();
    expect(disabled.sessionAffinityTtlMs).toBe(0);
    expect(resolveSessionAffinityTtlMs("test", {}, disabled)).toBe(0);
  });
});
