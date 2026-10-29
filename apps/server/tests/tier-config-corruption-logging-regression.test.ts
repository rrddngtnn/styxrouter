import { expect, test } from "bun:test";
import { getDbInstance } from "../src/lib/db/core";
import { initTierConfigTable, loadTierConfigFromDb } from "../src/lib/db/tierConfig";

test("corrupt tier config falls back and logs its reason and bounded value", () => {
  initTierConfigTable();
  const db = getDbInstance();
  const warnings: unknown[][] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => { warnings.push(args); };
  try {
    for (const raw of ["{" + "x".repeat(300), JSON.stringify({ invalid: true })]) {
      db.prepare("INSERT OR REPLACE INTO tier_config (key, value) VALUES ('tier_config', ?)").run(raw);
      expect(loadTierConfigFromDb()).toBeNull();
    }
    expect(warnings).toHaveLength(2);
    const joined = warnings.map((args) => args.join(" "));
    expect(joined[0]).toContain("JSON.parse failed");
    expect(joined[1]).toContain("Zod validation failed");
    expect(joined[0]).toContain("value");
    expect(joined[0]).not.toContain("x".repeat(250));
  } finally { console.warn = original; }
});
