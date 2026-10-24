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
