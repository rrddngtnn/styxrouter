import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { encodeTabular, decodeTabular } from "../open-sse/services/compression/engines/headroom/tabular.ts";
import { reconstructHeadroom } from "../open-sse/services/compression/engines/headroom/index.ts";
import { pickSmallestEncoding } from "../open-sse/services/compression/engines/headroom/smartcrusher.ts";
const root = resolve(import.meta.dir, "..");
test("candidate excludes GCF codec while retaining lossless TOON compression", () => {
  expect(existsSync(resolve(root, "open-sse/services/compression/engines/headroom/gcf/index.ts"))).toBe(false);
  const rows = [{ id: 1, value: null }, { id: 2, value: "a,b" }, { id: 3, nested: [1, true] }];
  const encoded = encodeTabular(rows);
  expect(encoded.startsWith("```toon\n")).toBe(true);
  expect(decodeTabular(encoded)).toEqual(rows);
  expect(pickSmallestEncoding(rows)).not.toContain("gcf-generic");
  const body = { messages: [{ role: "user", content: encoded }] };
  expect(reconstructHeadroom(body).messages[0].content).toBe(JSON.stringify(rows));
  const historical = "```gcf-generic\nGCF profile=generic\n## [0]\n```";
  expect(reconstructHeadroom({ messages: [{ content: historical }] }).messages[0].content).toBe(historical);
});
test("candidate excludes Free Claude recovery and DuckDuckGo port, not other search", async () => {
  expect(existsSync(resolve(root, "open-sse/services/streamRecovery.ts"))).toBe(false);
  expect(existsSync(resolve(root, "open-sse/services/freeWebSearch.ts"))).toBe(false);
  const { resolveSearchProvider } = await import("../open-sse/config/searchRegistry.ts");
  expect(resolveSearchProvider("duckduckgo-free")).toBeNull();
  expect(resolveSearchProvider("duckduckgo")).toBeNull();
  for (const id of ["brave", "serper", "zai-search", "x-search", "context7"]) {
    expect(resolveSearchProvider(id)).not.toBeNull();
  }
  const chat = readFileSync(resolve(root, "open-sse/handlers/chatCore.ts"), "utf8");
  expect(chat).not.toContain("createRecoverableStream");
  expect(chat).not.toContain("runUpstreamStream");
  expect(chat).toContain("wrapStreamWithWatchdog");
  const { resolveResilienceSettings } = await import("../src/lib/resilience/settings.ts");
  const resolved = resolveResilienceSettings({ resilienceSettings: { streamRecovery: { enabled: true, continueMidStream: true, throughputWatchdog: { enabled: true } } } });
  expect(resolved.streamRecovery.enabled).toBe(false);
  expect(resolved.streamRecovery.continueMidStream).toBe(false);
  expect(resolved.streamRecovery.throughputWatchdog.enabled).toBe(true);
});
