import type { RegistryEntry } from "../../../shared.ts";
import { KIMI_CODING_SHARED } from "../coding/index.ts";

export const kimi_coding_apikeyProvider: RegistryEntry = {
  id: "kimi-coding-apikey",
  vendor: "moonshot",
  category: "coding-agent",
  alias: "kmca",
  ...KIMI_CODING_SHARED,
  authType: "apikey",
};
