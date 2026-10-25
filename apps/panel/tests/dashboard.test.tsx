import { expect, test } from "bun:test";
import { providerHealth } from "../src/pages/dashboard-data.ts";
import type { Connection } from "../src/lib/types.ts";

const account = (id: string, changes: Partial<Connection> = {}): Connection => ({ id, provider: "codex", name: id, isActive: true, testStatus: null, lastError: null, backoffLevel: 0, rateLimitedUntil: null, tokenExpiresAt: null, ...changes });

test("provider health distinguishes unchecked, disabled and failing accounts; shows configured providers only", () => {
  const rows = providerHealth([account("unknown"), account("good", { testStatus: "active" }), account("off", { isActive: false }), account("bad", { backoffLevel: 2 })], new Map([["codex", "Codex"], ["unused", "Unused"]]), 0);
  expect(rows).toEqual([{ id: "codex", name: "Codex", total: 4, active: 3, healthy: 1, unchecked: 1, problems: 1 }]);
  expect(providerHealth([], new Map(), 0)).toEqual([]);
});
