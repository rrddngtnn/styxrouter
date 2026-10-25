/**
 * chatCore compression settings resolution (Quality Gate v2 / Fase 9 — chatCore god-file
 * decomposition, #3501).
 *
 * Extracted from handleChatCore's Proactive Context Compression setup: read the canonical
 * compression settings and derive the prompt-compression and delegated context-editing flags.
 * Best-effort — on a lookup error it logs and falls back to disabled, exactly like the previous
 * inline try/catch. Behaviour is byte-identical.
 */

import type { CompressionConfig } from "../../services/compression/types.ts";

type LoggerLike = { warn?: (...args: unknown[]) => void } | null | undefined;

export function createDisabledCompressionConfig(): CompressionConfig {
  return {
    enabled: false,
    defaultMode: "off",
    autoTriggerTokens: 0,
    cacheMinutes: 5,
    preserveSystemPrompt: true,
    comboOverrides: {},
    engines: {},
    activeComboId: null,
  };
}

// The token saver (prompt compression, Caveman, RTK, delegated context editing) is permanently off in StyxRouter:
// prompt shaping belongs to the client harness. The stored settings are ignored on purpose, so a leftover or imported
// "enabled" value can never alter a request. Both call sites (chatCore and the SSE chat handler) go through here.
export async function resolveCompressionSettings(_log?: LoggerLike): Promise<{
  settings: CompressionConfig | null;
  enabled: boolean;
  contextEditingEnabled: boolean;
}> {
  return { settings: createDisabledCompressionConfig(), enabled: false, contextEditingEnabled: false };
}
