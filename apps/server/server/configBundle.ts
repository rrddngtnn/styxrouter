import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { z } from "zod";
import { createCombo, deleteCombo, getComboByName, getCombos, updateCombo } from "../src/lib/db/combos.ts";
import { createProviderNode, getProviderNodes } from "../src/lib/db/providers.ts";
import { getSettings, updateSettings } from "../src/lib/db/settings.ts";
import { updateSettingsSchema } from "../src/shared/validation/settingsSchemas.ts";

export interface ConfigBundlePlaintext {
  version: 1;
  exportedAt: string;
  settings: Record<string, unknown>;
  combos: Array<Record<string, unknown>>;
  providerNodes: Array<Record<string, unknown>>;
}

export interface EncryptedConfigBundleEnvelope {
  format: "styx-encrypted-config-v1";
  salt: string;
  iv: string;
  tag: string;
  ciphertext: string;
}

const envelopeSchema = z
  .object({
    format: z.literal("styx-encrypted-config-v1"),
    salt: z.string().regex(/^[0-9a-f]{32}$/i),
    iv: z.string().regex(/^[0-9a-f]{24,32}$/i),
    tag: z.string().regex(/^[0-9a-f]{32}$/i),
    ciphertext: z.string().min(2).max(4 * 1024 * 1024),
  })
  .strict();

export function encryptConfigBundle(
  payload: ConfigBundlePlaintext,
  passphrase: string,
): EncryptedConfigBundleEnvelope {
  if (typeof passphrase !== "string" || passphrase.trim().length < 12) {
    throw new Error("Passphrase must be at least 12 characters");
  }
  const salt = randomBytes(16);
  const iv = randomBytes(16);
  const key = scryptSync(passphrase, salt, 32);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    format: "styx-encrypted-config-v1",
    salt: salt.toString("hex"),
    iv: iv.toString("hex"),
    tag: tag.toString("hex"),
    ciphertext: encrypted.toString("hex"),
  };
}

export function decryptConfigBundle(
  envelopeInput: unknown,
  passphrase: string,
): ConfigBundlePlaintext {
  if (typeof passphrase !== "string" || passphrase.trim().length < 12) {
    throw new Error("Passphrase must be at least 12 characters");
  }
  const parsed = envelopeSchema.safeParse(envelopeInput);
  if (!parsed.success) {
    throw new Error("Invalid encrypted bundle format");
  }
  const { salt, iv, tag, ciphertext } = parsed.data;
  const key = scryptSync(passphrase, Buffer.from(salt, "hex"), 32);
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "hex"), {
    authTagLength: 16,
  });
  decipher.setAuthTag(Buffer.from(tag, "hex"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "hex")),
    decipher.final(),
  ]);
  const data = JSON.parse(decrypted.toString("utf8")) as ConfigBundlePlaintext;
  if (
    !data ||
    typeof data !== "object" ||
    data.version !== 1 ||
    !data.settings ||
    typeof data.settings !== "object" ||
    !Array.isArray(data.combos)
  ) {
    throw new Error("Invalid decrypted bundle payload");
  }
  return data;
}

const PORTABLE_SETTINGS_KEYS = [
  "fallbackStrategy",
  "comboStrategy",
  "requestRetry",
  "maxRetryIntervalSec",
  "stickyRoundRobinLimit",
  "disableSessionStickiness",
  "promptCacheAffinityEnabled",
  "lkgpEnabled",
  "autoRefreshProviderQuota",
  "wildcardAliases",
  "blockedProviders",
  "hideAutoCombos",
  "hideNoThinkVariants",
  "preferClaudeCodeForUnprefixedClaudeModels",
  "thinkingBudget",
  "codexServiceTier",
] as const;

export async function buildPortableConfigBundle(): Promise<ConfigBundlePlaintext> {
  const rawSettings = (await getSettings()) as Record<string, unknown>;
  const settings: Record<string, unknown> = {};
  for (const k of PORTABLE_SETTINGS_KEYS) {
    if (rawSettings[k] !== undefined) {
      settings[k] = rawSettings[k];
    }
  }
  const allCombos = (await getCombos()) as Array<Record<string, unknown>>;
  const combos = allCombos
    .filter((c) => typeof c.name === "string" && !String(c.name).startsWith("__quota_"))
    .map((c) => ({
      name: c.name,
      strategy: c.strategy ?? "priority",
      models: Array.isArray(c.models) ? c.models : [],
      config: c.config ?? undefined,
      isActive: c.isActive !== false,
    }));

  const nodes = (await getProviderNodes()) as Array<Record<string, unknown>>;
  const providerNodes = nodes.map((n) => ({
    type: n.type,
    name: n.name,
    prefix: n.prefix ?? null,
    apiType: n.apiType ?? null,
    baseUrl: n.baseUrl ?? null,
    chatPath: n.chatPath ?? null,
    modelsPath: n.modelsPath ?? null,
  }));

  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    settings,
    combos,
    providerNodes,
  };
}

export async function applyPortableConfigBundle(
  bundle: ConfigBundlePlaintext,
  mode: "merge" | "replace",
): Promise<{
  settingsUpdated: number;
  combosImported: number;
  providerNodesImported: number;
}> {
  const safeSettingsInput: Record<string, unknown> = {};
  for (const k of PORTABLE_SETTINGS_KEYS) {
    if (bundle.settings[k] !== undefined) {
      safeSettingsInput[k] = bundle.settings[k];
    }
  }
  const validatedSettings = updateSettingsSchema.partial().safeParse(safeSettingsInput);
  let settingsUpdated = 0;
  if (validatedSettings.success && Object.keys(validatedSettings.data).length > 0) {
    await updateSettings(validatedSettings.data);
    settingsUpdated = Object.keys(validatedSettings.data).length;
  }

  if (mode === "replace") {
    const existing = (await getCombos()) as Array<{ id: string; name?: string }>;
    for (const c of existing) {
      if (typeof c.name === "string" && !c.name.startsWith("__quota_")) {
        await deleteCombo(c.id);
      }
    }
  }

  let combosImported = 0;
  for (const rawCombo of bundle.combos) {
    if (!rawCombo || typeof rawCombo.name !== "string" || !Array.isArray(rawCombo.models)) {
      continue;
    }
    const existing = (await getComboByName(rawCombo.name)) as { id: string } | null;
    if (existing) {
      await updateCombo(existing.id, {
        strategy: typeof rawCombo.strategy === "string" ? rawCombo.strategy : "priority",
        models: rawCombo.models as never,
        isActive: rawCombo.isActive !== false,
      } as never);
      combosImported += 1;
    } else {
      await createCombo({
        name: rawCombo.name,
        strategy: typeof rawCombo.strategy === "string" ? rawCombo.strategy : "priority",
        models: rawCombo.models as never,
      } as never);
      combosImported += 1;
    }
  }

  let providerNodesImported = 0;
  if (Array.isArray(bundle.providerNodes)) {
    const existingNodes = (await getProviderNodes()) as Array<{ prefix?: string | null; name?: string }>;
    const usedPrefixes = new Set(existingNodes.map((n) => n.prefix).filter(Boolean));
    for (const n of bundle.providerNodes) {
      if (
        !n ||
        typeof n.name !== "string" ||
        typeof n.prefix !== "string" ||
        typeof n.baseUrl !== "string" ||
        usedPrefixes.has(n.prefix)
      ) {
        continue;
      }
      try {
        await createProviderNode({
          type: n.type === "anthropic-compatible" ? "anthropic-compatible" : "openai-compatible",
          name: n.name,
          prefix: n.prefix,
          apiType: typeof n.apiType === "string" ? n.apiType : "chat",
          baseUrl: n.baseUrl,
          chatPath: typeof n.chatPath === "string" ? n.chatPath : null,
          modelsPath: typeof n.modelsPath === "string" ? n.modelsPath : null,
        } as never);
        usedPrefixes.add(n.prefix);
        providerNodesImported += 1;
      } catch {
        // Skip conflicting or invalid node
      }
    }
  }

  return { settingsUpdated, combosImported, providerNodesImported };
}
