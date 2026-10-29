import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getDbInstance } from "../src/lib/db/core";
import { getCombos } from "../src/lib/db/combos";
import { getQuotaComboGeneration } from "../src/lib/db/quotaComboGeneration";
import { syncQuotaCombos } from "../src/lib/quota/quotaCombos";

type MissingSource = "group" | "connection";
type Combo = { name: string; models: Array<{ connectionId: string }>; quotaComboGeneration: number };

function insertConnection(id: string) {
  getDbInstance().prepare("INSERT INTO provider_connections (id, provider, created_at, updated_at) VALUES (?, 'openai', '2026-01-01', '2026-01-01')").run(id);
}

function seedMissingSource(source: MissingSource, paused: boolean) {
  const id = `insert-${source}-${paused ? "paused" : "reconciled"}`;
  const connectionId = `${id}-connection`;
  const groupId = `${id}-group`;
  const fallbackName = `${source}${paused ? "paused" : "reconciled"}fallback`;
  const groupName = `${source}${paused ? "paused" : "reconciled"}restored`;
  const db = getDbInstance();
  // Raw SQL deliberately avoids queued CRUD maintenance. Pool references are
  // allowed to predate their source records by the historical schema.
  db.immediate(() => {
    if (source !== "connection") insertConnection(connectionId);
    if (source !== "group") db.prepare("INSERT INTO quota_groups (id, name) VALUES (?, ?)").run(groupId, groupName);
    db.prepare("INSERT INTO quota_pools (id, connection_id, group_id, name, created_at, exclusive) VALUES (?, ?, ?, ?, '2026-01-01', 0)").run(id, connectionId, groupId, fallbackName);
    db.prepare("INSERT INTO quota_pool_connections (pool_id, connection_id) VALUES (?, ?)").run(id, connectionId);
  });
  return {
    id, connectionId, fallbackPrefix: `qtSd/${fallbackName}/`, expectedPrefix: `qtSd/${groupName}/`,
    insertMissing() {
      if (source === "group") db.prepare("INSERT INTO quota_groups (id, name) VALUES (?, ?)").run(groupId, groupName);
      else insertConnection(connectionId);
    },
  };
}

function rawCombos(): Combo[] {
  const rows = getDbInstance().prepare("SELECT data FROM combos WHERE name LIKE 'qtSd/%'").all() as { data: string }[];
  return rows.map(row => JSON.parse(row.data));
}

function expectRestoredProjection(fixture: ReturnType<typeof seedMissingSource>, combos: Combo[]) {
  const restored = combos.filter(combo => combo.name.startsWith(fixture.expectedPrefix));
  expect(restored.length).toBeGreaterThan(0);
  expect(combos.some(combo => combo.name.startsWith(fixture.fallbackPrefix))).toBe(false);
  for (const combo of restored) {
    expect(combo.models.map(step => step.connectionId)).toEqual([fixture.connectionId]);
    expect(combo.quotaComboGeneration).toBe(getQuotaComboGeneration());
  }
}

async function insertDuringPausedPreparation(fixture: ReturnType<typeof seedMissingSource>) {
  const barrierDir = mkdtempSync(join(process.env.TMPDIR!, "source-insert-"));
  const ready = join(barrierDir, "ready");
  const release = join(barrierDir, "release");
  // Pause after ALL source reads and the prune-list snapshot, including when a
  // missing connection produced no desired combos.
  const child = Bun.spawn([process.execPath, "-e", `
    const { spyOn } = await import('bun:test');
    const reconciliation = await import('./src/lib/db/quotaComboReconciliation');
    const original = reconciliation.listQuotaComboNames;
    let paused = false;
    spyOn(reconciliation, 'listQuotaComboNames').mockImplementation(async () => {
      const result = await original();
      if (!paused) {
        paused = true;
        require('node:fs').writeFileSync(process.argv[2], 'ready');
        while (!require('node:fs').existsSync(process.argv[3])) await Bun.sleep(5);
      }
      return result;
    });
    const { syncQuotaCombos } = await import('./src/lib/quota/quotaCombos');
    await syncQuotaCombos(process.argv[1]);
  `, fixture.id, ready, release], { cwd: process.cwd(), env: process.env, stdout: "ignore", stderr: "pipe" });
  try {
    const deadline = Date.now() + 15000;
    while (!existsSync(ready) && Date.now() < deadline && child.exitCode === null) await Bun.sleep(5);
    expect(existsSync(ready)).toBe(true);
    const generation = getQuotaComboGeneration();
    fixture.insertMissing();
    writeFileSync(release, "go");
    expect(await child.exited).toBe(0);
    // No facade read or fresh sync is allowed to repair a stale child commit.
    expectRestoredProjection(fixture, rawCombos());
    expect(getQuotaComboGeneration()).toBe(generation + 1);
    const marker = getDbInstance().prepare("SELECT value FROM db_meta WHERE key = 'quota_combo_reconciled_generation'").get() as { value: string };
    expect(Number(marker.value)).toBe(generation + 1);
  } finally {
    writeFileSync(release, "go");
    if (child.exitCode === null) child.kill();
    await child.exited;
    rmSync(barrierDir, { recursive: true, force: true });
  }
}

for (const source of ["group", "connection"] as const) {
  test(`inserting a missing referenced ${source} after reconciliation invalidates read recovery`, async () => {
    const fixture = seedMissingSource(source, false);
    await syncQuotaCombos(fixture.id);
    const baseline = rawCombos();
    if (source === "group") expect(baseline.some(combo => combo.name.startsWith(fixture.fallbackPrefix))).toBe(true);
    expect(baseline.some(combo => combo.name.startsWith(fixture.expectedPrefix))).toBe(false);
    const generation = getQuotaComboGeneration();
    fixture.insertMissing();
    expectRestoredProjection(fixture, await getCombos() as unknown as Combo[]);
    expect(getQuotaComboGeneration()).toBe(generation + 1);
  });

  test(`inserting a missing referenced ${source} during paused preparation rejects the stale projection`, async () => {
    const fixture = seedMissingSource(source, true);
    await syncQuotaCombos(fixture.id);
    await insertDuringPausedPreparation(fixture);
  }, 30000);
}
