import { normalizeEffort, type CanonicalEffort } from "./effortStandardization";

/** A provider declaration on an exact wire row, never inferred from its spelling. */
export type EffortVariant = { baseModel: string; effort: CanonicalEffort; default?: true };

export function normalizeEffortVariant(value: unknown, wireId: string): EffortVariant | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const { baseModel, effort, default: isDefault } = value as Record<string, unknown>;
  if (
    typeof baseModel !== "string" ||
    !baseModel ||
    baseModel.trim() !== baseModel ||
    /[\s/]/.test(baseModel) ||
    baseModel === wireId ||
    !wireId ||
    /\s/.test(wireId)
  ) {
    return;
  }
  const canonical = normalizeEffort(effort);
  if (!canonical) return;
  return { baseModel, effort: canonical, ...(isDefault === true ? { default: true } : {}) };
}

export type EffortRoute = { wireId: string; connectionIds: Set<string> };
export type EffortFamily = {
  tiers: Map<CanonicalEffort, EffortRoute>;
  defaultEffort?: CanonicalEffort;
  conflicts: Set<CanonicalEffort>;
};

export function collectEffortFamilies<T extends { id: string; effortVariant?: EffortVariant }>(
  inventories: Iterable<readonly [string, readonly T[]]>,
  isEligible: (connectionId: string, row: T) => boolean = () => true
): Map<string, EffortFamily> {
  const families = new Map<string, EffortFamily>();
  const literalIds = new Set<string>();
  const defaults = new Map<string, Set<CanonicalEffort>>();
  for (const [connectionId, rows] of inventories) {
    for (const row of rows) {
      const { id, effortVariant: variant } = row;
      literalIds.add(id);
      if (!variant) continue;
      let family = families.get(variant.baseModel);
      if (!family) {
        family = { tiers: new Map(), conflicts: new Set() };
        families.set(variant.baseModel, family);
      }
      if (!isEligible(connectionId, row)) continue;
      if (variant.default) {
        let declared = defaults.get(variant.baseModel);
        if (!declared) defaults.set(variant.baseModel, (declared = new Set()));
        declared.add(variant.effort);
      }
      const prior = family.tiers.get(variant.effort);
      if (prior && prior.wireId !== id) family.conflicts.add(variant.effort);
      else if (prior) prior.connectionIds.add(connectionId);
      else family.tiers.set(variant.effort, { wireId: id, connectionIds: new Set([connectionId]) });
    }
  }
  for (const [base, family] of families) {
    // A real base ID is not a virtual model, even if another account declares a family.
    if (literalIds.has(base)) {
      families.delete(base);
      continue;
    }
    for (const tier of family.conflicts) family.tiers.delete(tier);
    const declared = defaults.get(base);
    const [preferred] = declared ?? [];
    if (declared?.size === 1 && preferred && family.tiers.has(preferred)) {
      family.defaultEffort = preferred;
    }
  }
  return families;
}
