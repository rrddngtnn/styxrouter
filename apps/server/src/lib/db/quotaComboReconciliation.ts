import { randomUUID } from "node:crypto";
import { getDbInstance } from "./core";
import { getQuotaComboGeneration } from "./quotaComboGeneration";
import { invalidateDbCache } from "./readCache";

type ComboStep = {
  kind: "model";
  model: string;
  providerId: string;
  connectionId: string;
  weight: number;
};

export type QuotaComboWrite = {
  name: string;
  models: ComboStep[];
  strategy: string;
  isHidden: true;
};

type ComboRow = {
  id: string;
  name: string;
  data: string;
  sort_order: number;
  created_at: string;
};

/**
 * Snapshot row identities without interpreting the managed projection. Neither a
 * corrupt managed row nor an unrelated user JSON blob may block reconciliation.
 * Keep this asynchronous preparation boundary outside the fenced transaction.
 */
export async function listQuotaComboNames(): Promise<string[]> {
  const rows = getDbInstance().prepare("SELECT name FROM combos").all() as { name: string }[];
  return rows.map(row => row.name);
}

function stepId(comboName: string, index: number, step: ComboStep): string {
  const slug = `${comboName}-${index + 1}-${step.model}-${step.connectionId}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.slice(0, 200);
}

function normalizeSteps(combo: QuotaComboWrite): Array<ComboStep & { id: string }> {
  return combo.models.map((step, index) => ({ ...step, id: stepId(combo.name, index, step) }));
}

/**
 * Apply one complete reconciliation under SQLite's cross-process write lock.
 * No writes occur when the durable generation changed while async preparation
 * was in flight. Returning false asks the caller to rebuild from current data.
 */
export function applyQuotaComboReconciliation(
  generation: number,
  upserts: QuotaComboWrite[],
  pruneNames: string[],
): boolean {
  const db = getDbInstance();
  let applied = false;
  db.immediate(() => {
    if (getQuotaComboGeneration() !== generation) return;

    const now = new Date().toISOString();
    const selectByName = db.prepare(
      "SELECT id, name, data, sort_order, created_at FROM combos WHERE name = ?",
    );
    const selectMaxSort = db.prepare("SELECT COALESCE(MAX(sort_order), 0) AS value FROM combos");
    const insert = db.prepare(
      "INSERT INTO combos (id, name, data, sort_order, created_at, updated_at, context_cache_protection) VALUES (?, ?, ?, ?, ?, ?, 0)",
    );
    const update = db.prepare(
      "UPDATE combos SET data = ?, updated_at = ?, context_cache_protection = 0 WHERE id = ?",
    );
    const remove = db.prepare("DELETE FROM combos WHERE name = ?");
    const changedNames = new Set<string>();

    for (const combo of upserts) {
      const existing = selectByName.get(combo.name) as ComboRow | undefined;
      const payload = {
        name: combo.name,
        models: normalizeSteps(combo),
        strategy: combo.strategy,
        isHidden: true,
        quotaComboGeneration: generation,
      };
      if (existing) {
        let previous: Record<string, unknown> = {};
        try {
          const parsed = JSON.parse(existing.data) as unknown;
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            previous = parsed as Record<string, unknown>;
          }
        } catch {
          // Reconcile corrupt managed JSON into a valid projection.
        }
        const next = {
          ...previous,
          ...payload,
          id: existing.id,
          sortOrder: existing.sort_order,
          createdAt: existing.created_at || now,
          updatedAt: now,
          version: 2,
        };
        update.run(JSON.stringify(next), now, existing.id);
      } else {
        const id = randomUUID();
        const sortRow = selectMaxSort.get() as { value: number };
        const sortOrder = Number(sortRow.value) + 1;
        const next = {
          ...payload,
          id,
          config: {},
          sortOrder,
          createdAt: now,
          updatedAt: now,
          version: 2,
        };
        insert.run(id, combo.name, JSON.stringify(next), sortOrder, now, now);
      }
      changedNames.add(combo.name);
    }

    for (const name of new Set(pruneNames)) {
      if (changedNames.has(name)) continue;
      remove.run(name);
    }
    db.prepare("INSERT OR REPLACE INTO db_meta (key, value) VALUES ('quota_combo_reconciled_generation', ?)").run(String(generation));
    applied = true;
  });
  if (applied) invalidateDbCache("combos");
  return applied;
}
