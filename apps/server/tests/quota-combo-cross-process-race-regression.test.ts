import { expect, test } from "bun:test";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createProviderConnection } from "../src/lib/db/providers";
import { getDbInstance } from "../src/lib/db/core";
import { syncQuotaCombos } from "../src/lib/quota/quotaCombos";

test("an older sync in another process cannot overwrite newer pool membership", async () => {
  const a = await createProviderConnection({ provider: "openai", authType: "apikey", apiKey: "x", name: "race-a" } as any);
  const b = await createProviderConnection({ provider: "openai", authType: "apikey", apiKey: "different-key", name: "race-b" } as any);
  const pool = { id: crypto.randomUUID() };
  // No CRUD hooks/queued maintenance anywhere in the parent: the two explicit
  // sync calls below are the only possible parent workers.
  const database = getDbInstance();
  database.immediate(() => {
    database.prepare("INSERT INTO quota_pools (id, connection_id, name, group_id, created_at, exclusive) VALUES (?, ?, 'race', 'group-demo', ?, 0)").run(pool.id, a.id, new Date().toISOString());
    database.prepare("INSERT INTO quota_pool_connections (pool_id, connection_id) VALUES (?, ?)").run(pool.id, a.id);
  });
  await syncQuotaCombos(pool.id);
  const ready = join(process.env.TMPDIR!, "combo-ready");
  const release = join(process.env.TMPDIR!, "combo-release");
  const child = Bun.spawn([process.execPath, "-e", `
    const { spyOn } = await import('bun:test');
    const repo = await import('./src/lib/db/quotaComboReconciliation');
    const original = repo.listQuotaComboNames;
    let paused = false;
    spyOn(repo, 'listQuotaComboNames').mockImplementation(async () => {
      const result = await original();
      if (!paused) {
        paused = true;
        require('node:fs').writeFileSync(process.argv[2], JSON.stringify(result));
        while (!require('node:fs').existsSync(process.argv[3])) await Bun.sleep(10);
      }
      return result;
    });
    const { syncQuotaCombos } = await import('./src/lib/quota/quotaCombos');
    await syncQuotaCombos(process.argv[1]);
  `, pool.id, ready, release], { cwd: process.cwd(), stdout: "pipe", stderr: "pipe", env: process.env });
  try {
    const deadline = Date.now() + 15000;
    while (!existsSync(ready) && Date.now() < deadline && child.exitCode === null) await Bun.sleep(10);
    expect(existsSync(ready)).toBe(true);
    expect(a.id).not.toBe(b.id);
    // Raw writes deliberately avoid enqueuing maintenance. Only this explicit
    // fresh sync runs, so no delayed parent worker can hide a stale child write.
    const db = getDbInstance();
    db.immediate(() => {
      db.prepare("DELETE FROM quota_pool_connections WHERE pool_id = ?").run(pool.id);
      db.prepare("INSERT INTO quota_pool_connections (pool_id, connection_id) VALUES (?, ?)").run(pool.id, b.id);
      db.prepare("UPDATE quota_pools SET connection_id = ? WHERE id = ?").run(b.id, pool.id);
    });
    await syncQuotaCombos(pool.id);
    writeFileSync(release, "go");
    expect(await child.exited).toBe(0);
    // Inspect durable rows directly: a facade read must not repair a bad child
    // write and accidentally turn this writer-race regression green.
    const combos = (db.prepare("SELECT data FROM combos WHERE name LIKE 'qtSd/%'").all() as { data: string }[]).map(row => JSON.parse(row.data));
    expect(combos.length).toBeGreaterThan(0);
    for (const combo of combos) expect([...new Set((combo.models as any[]).map(step => step.connectionId))]).toEqual([b.id]);
  } finally {
    writeFileSync(release, "go");
    if (child.exitCode === null) child.kill();
    await child.exited;
  }
}, 30000);
