/**
 * Provider registry metadata contract.
 *
 * Every provider entry must declare a vendor and a capability category, and no model object may
 * carry those provider-level attributes. The registry is loaded as real objects (not scanned as
 * text), so several entries in one file or attributes placed on the wrong object are caught.
 */
import { describe, expect, test } from "bun:test";
import { Glob } from "bun";
import path from "node:path";
import { getProviderById, getProviderLabel } from "../src/shared/constants/providers.ts";
import { REGISTRY } from "../open-sse/config/providers/index.ts";

const ROOT = path.resolve(import.meta.dir, "../open-sse/config/providers/registry");

const CATEGORIES = new Set([
  "chat",
  "coding-agent",
  "web-session",
  "image",
  "video",
  "audio",
  "search",
  "embedding",
  "rerank",
  "media",
]);

type Entry = { file: string; exportName: string; value: any };

const isEntry = (v: any) =>
  v && typeof v === "object" && !Array.isArray(v) && typeof v.id === "string" && ("executor" in v || "format" in v);

// A model object must not carry provider-level attributes. `category` is only a violation when it
// holds a taxonomy value: some model tables use their own unrelated `category` (e.g. "Text").
const hasStrayAttribute = (m: any) =>
  m && typeof m === "object" && ("vendor" in m || ("category" in m && CATEGORIES.has(m.category)));

async function loadRegistry() {
  const entries = new Map<string, Entry>();
  const stray: string[] = [];
  for await (const file of new Glob("**/index.ts").scan(ROOT)) {
    const mod = await import(path.join(ROOT, file));
    for (const [exportName, value] of Object.entries(mod) as [string, any][]) {
      if (isEntry(value)) {
        if (!entries.has(value.id)) entries.set(value.id, { file, exportName, value });
        if (Array.isArray(value.models) && value.models.some(hasStrayAttribute)) {
          stray.push(`${file}#${exportName}.models`);
        }
      } else if (Array.isArray(value) && value.some(hasStrayAttribute)) {
        stray.push(`${file}#${exportName}[]`);
      }
    }
  }
  return { entries, stray };
}

describe("provider registry metadata", () => {
  test("every provider entry declares a vendor and a known category", async () => {
    const { entries } = await loadRegistry();
    const problems: string[] = [];
    for (const [id, { file, value }] of entries) {
      if (typeof value.vendor !== "string" || value.vendor.length === 0) {
        problems.push(`${id} (${file}): missing vendor`);
      }
      if (!CATEGORIES.has(value.category)) {
        problems.push(`${id} (${file}): category ${JSON.stringify(value.category)} is not in the taxonomy`);
      }
    }
    expect(problems).toEqual([]);
    expect(entries.size).toBeGreaterThan(40); // guards against the loader silently finding nothing
  });

  test("no model object carries a provider-level vendor or category", async () => {
    const { stray } = await loadRegistry();
    expect(stray).toEqual([]);
  });
});

// GET /api/providers labels each provider with getProviderLabel. A label equal to the raw id
// (e.g. "kimi-coding-apikey") is unreadable in the panel; two providers sharing a label is the
// GLM/ZAI kind of confusion.
describe("served provider labels", () => {
  // Alias keys point at the same entry object; the served list keeps only canonical ids.
  const served = Object.entries(REGISTRY).filter(([id, entry]: [string, any]) => entry.id === id);

  test("the catalog displayName wins, then the maintained dashboard name, then the id", () => {
    expect(getProviderLabel("openai", "Override")).toBe("Override");
    expect(getProviderLabel("openai")).toBe(getProviderById("openai")?.name);
    expect(getProviderLabel("no-such-provider")).toBe("no-such-provider");
  });

  test("every served provider has a readable label and no two share one", () => {
    const labels = served.map(([id, entry]: [string, any]) => [id, getProviderLabel(id, entry.displayName)] as const);
    expect(labels.filter(([id, l]) => l === id).map(([id]) => id)).toEqual([]);
    const byLabel = new Map<string, string[]>();
    for (const [id, l] of labels) byLabel.set(l.toLowerCase(), [...(byLabel.get(l.toLowerCase()) ?? []), id]);
    expect([...byLabel.values()].filter((ids) => ids.length > 1)).toEqual([]);
    expect(served.length).toBeGreaterThan(40);
  });
});
