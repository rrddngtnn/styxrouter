import { expect, test } from "bun:test";
import { createProviderConnection } from "../src/lib/db/providers";
import { createPool, deletePool } from "../src/lib/db/quotaPools";
import { syncQuotaCombos } from "../src/lib/quota/quotaCombos";
import { getCombos } from "../src/lib/db/combos";

test("deleting a pool removes its provider's combos while preserving a different provider sibling", async () => {
  const a = await createProviderConnection({ provider: "openai", authType: "apikey", apiKey: "a", name: "a" } as any);
  const b = await createProviderConnection({ provider: "anthropic", authType: "apikey", apiKey: "b", name: "b" } as any);
  const p = createPool({ connectionId: a.id, name: "a" });
  const sibling = createPool({ connectionId: b.id, name: "b" });
  await syncQuotaCombos(p.id);
  await syncQuotaCombos(sibling.id);
  const before = (await getCombos()).map(c => String(c.name));
  expect(before.some(n => n.includes("/openai/"))).toBe(true);
  expect(before.some(n => n.includes("/anthropic/"))).toBe(true);
  expect(await deletePool(p.id)).toBe(true);
  const after = (await getCombos()).map(c => String(c.name));
  expect(after.some(n => n.includes("/openai/"))).toBe(false);
  expect(after.some(n => n.includes("/anthropic/"))).toBe(true);
});

test("deleting a pool preserves and refreshes a same-provider sibling", async () => {
  const a = await createProviderConnection({ provider: "openai", authType: "apikey", apiKey: "one", name: "same-a" } as any);
  const b = await createProviderConnection({ provider: "openai", authType: "apikey", apiKey: "two", name: "same-b" } as any);
  const p = createPool({ connectionId: a.id, name: "same-a" });
  const sibling = createPool({ connectionId: b.id, name: "same-b" });
  await syncQuotaCombos(p.id);
  await syncQuotaCombos(sibling.id);
  expect(await deletePool(p.id)).toBe(true);
  const combos = (await getCombos()).filter(c => String(c.name).includes("/openai/"));
  expect(combos.length).toBeGreaterThan(0);
  for (const combo of combos) {
    const steps = combo.models as any[];
    expect(steps.some(s => s.connectionId === b.id)).toBe(true);
    expect(steps.some(s => s.connectionId === a.id)).toBe(false);
  }
  expect(await deletePool(sibling.id)).toBe(true);
});

test("concurrent sibling deletions leave no shared provider routes", async () => {
  const connections = await Promise.all(["race-a", "race-b"].map(name =>
    createProviderConnection({ provider: "openai", authType: "apikey", apiKey: name, name } as any)));
  const pools = connections.map((c, i) => createPool({ connectionId: c.id, name: `race-${i}` }));
  await syncQuotaCombos(pools[0].id);
  expect(await Promise.all(pools.map(p => deletePool(p.id)))).toEqual([true, true]);
  expect((await getCombos()).some(c => String(c.name).includes("/openai/"))).toBe(false);
});
