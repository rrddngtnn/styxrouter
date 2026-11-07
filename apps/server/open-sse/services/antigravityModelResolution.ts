import { getMitmAlias } from "@/lib/db/models/mitmAlias";
import { resolveAntigravityModelId } from "../config/antigravityModelAliases.ts";

/** Resolve once for both account selection and dispatch. Exact catalog IDs win. */
export async function resolveAntigravityWireModel(model: string, exact = false): Promise<string> {
  if (exact) return model;
  const stripped = model.includes("/") ? model.split("/").pop()! : model;
  if (!stripped) return stripped;
  try {
    const aliases = await getMitmAlias("antigravity");
    const raw = aliases && typeof aliases === "object" ? aliases[stripped] : undefined;
    if (typeof raw === "string" && raw && raw !== stripped) {
      return raw.startsWith("antigravity/") ? raw.slice("antigravity/".length) : raw;
    }
  } catch {
    // DB unavailable: preserve the executor's static fallback behavior.
  }
  return resolveAntigravityModelId(stripped);
}
