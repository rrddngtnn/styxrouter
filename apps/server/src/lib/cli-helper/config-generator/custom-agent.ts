/**
 * CustomAgent Agent — Rich multi-role config generator & saver
 *
 * This is the implementation for the advanced "CustomAgent Agent" (Nous Research terminal agent).
 * It is treated completely separately from the original simple "CustomAgent" guide tool.
 *
 * CustomAgent Agent supports many independent model slots:
 *   - default (main conversation)
 *   - delegation (sub-agent orchestrator)
 *   - auxiliary.* (vision, compression, web_extract, skills_hub, approval, ...)
 *
 * The UI (CustomAgentToolCard) will offer a dropdown for EACH of these roles.
 *
 * Data Model (what the frontend sends and this module consumes):
 *
 * interface CustomAgentRoleSelection {
 *   role: 'default' | 'delegation' | 'vision' | 'compression' | 'web_extract' | 'skills_hub' | 'approval' | ...;
 *   model: string;                    // the model name the user chose from StyxRouter
 * }
 *
 * interface CustomAgentConfigPayload {
 *   baseUrl: string;                  // usually the StyxRouter base URL
 *   keyId?: string | null;            // preferred: reference to a stored key
 *   apiKey?: string | null;           // fallback plaintext key
 *   selections: CustomAgentRoleSelection[];
 * }
 */

import * as yaml from "js-yaml";
import { getCustomAgentConfigPath } from "./customAgentHome.ts";

export const CUSTOMAGENT_AGENT_ROLES = [
  { id: "default", label: "Default (main)", description: "Primary conversation model" },
  {
    id: "delegation",
    label: "Delegation (subagents)",
    description: "Orchestrator and sub-agent spawning model",
  },
  { id: "vision", label: "Vision", description: "Image and screenshot understanding" },
  { id: "web_extract", label: "Web Extract", description: "Web page / content extraction" },
  { id: "compression", label: "Compression", description: "Prompt compression and summarization" },
  { id: "skills_hub", label: "Skills Hub", description: "Skills and tool-use reasoning" },
  { id: "approval", label: "Approval", description: "Safety and approval decisions" },
  { id: "mcp", label: "MCP", description: "MCP server tool calls" },
  { id: "title_generation", label: "Title Generation", description: "Session title generation" },
  {
    id: "memory_query_rewrite",
    label: "Memory Query Rewrite",
    description: "Memory search query rewriting",
  },
  { id: "tts_audio_tags", label: "TTS Audio Tags", description: "TTS audio tag generation" },
  {
    id: "triage_specifier",
    label: "Triage Specifier",
    description: "Issue / PR triage specification",
  },
  {
    id: "kanban_decomposer",
    label: "Kanban Decomposer",
    description: "Kanban task decomposition",
  },
  { id: "profile_describer", label: "Profile Describer", description: "User profile description" },
  { id: "goal_judge", label: "Goal Judge", description: "Goal completion judging" },
  { id: "curator", label: "Curator", description: "Skill and memory curation" },
  { id: "monitor", label: "Monitor", description: "Background monitoring" },
  {
    id: "background_review",
    label: "Background Review",
    description: "Background code review",
  },
] as const;

export type CustomAgentRole = (typeof CUSTOMAGENT_AGENT_ROLES)[number]["id"];

export interface CustomAgentRoleSelection {
  role: CustomAgentRole;
  model: string;
}

export interface CustomAgentConfigPayload {
  baseUrl: string;
  keyId?: string | null;
  apiKey?: string | null;
  selections: CustomAgentRoleSelection[];
}

// Resolved lazily at call-time so CUSTOMAGENT_HOME is always honoured (#3628).
const getConfigPath = () => getCustomAgentConfigPath();

// Build a normalized base URL for CustomAgent (no trailing slash, no /v1 suffix on the provider entry)
function normalizeBaseUrl(base: string): string {
  let b = base.trim();
  while (b.endsWith("/")) b = b.slice(0, -1);
  if (b.endsWith("/v1")) b = b.slice(0, -3);
  return b;
}

function getProviderBlock(baseUrl: string, apiKey: string) {
  const normalized = normalizeBaseUrl(baseUrl);
  return {
    provider: "styx",
    model: "", // will be filled per-role
    base_url: `${normalized}/v1`,
    api_key: apiKey,
  };
}

/**
 * Generate the full merged YAML for CustomAgent Agent config.
 * This is the core of the rich implementation.
 */
export async function generateCustomAgentConfig(
  payload: CustomAgentConfigPayload
): Promise<{ yaml: string; error?: string }> {
  const { baseUrl, keyId, apiKey, selections } = payload;

  if (!baseUrl) {
    return { yaml: "", error: "baseUrl is required" };
  }

  // Resolve the actual key to use (in real impl we would look up keyId)
  const resolvedKey = apiKey || "YOUR_STYX_API_KEY_HERE";

  // Read existing config if present (non-destructive merge)
  let existing: any = {};
  try {
    const fs = await import("node:fs/promises");
    const raw = await fs.readFile(getConfigPath(), "utf-8");
    existing = yaml.load(raw) || {};
  } catch {
    // no existing file — start fresh
  }

  // Build the providers.styx entry (shared)
  const normalizedBase = normalizeBaseUrl(baseUrl);
  const styxProvider = {
    base_url: `${normalizedBase}/v1`,
    api_key: resolvedKey,
  };

  // Start from existing or empty
  const next: any = {
    ...existing,
    providers: {
      ...(existing.providers || {}),
      styx: styxProvider,
    },
  };

  // Apply each role selection
  for (const sel of selections) {
    const { role, model } = sel;

    if (role === "default") {
      next.model = {
        ...(existing.model || {}),
        default: model,
        provider: "styx",
        base_url: `${normalizedBase}/v1`,
      };
    } else if (role === "delegation") {
      next.delegation = {
        ...(existing.delegation || {}),
        model,
        provider: "styx",
        base_url: `${normalizedBase}/v1`,
        api_key: resolvedKey,
      };
    } else {
      // auxiliary.* roles
      if (!next.auxiliary) next.auxiliary = {};
      next.auxiliary[role] = {
        ...(existing.auxiliary?.[role] || {}),
        provider: "styx",
        model,
        base_url: `${normalizedBase}/v1`,
        api_key: resolvedKey,
      };
    }
  }

  const outputYaml = yaml.dump(next, { lineWidth: -1, noRefs: true });
  return { yaml: outputYaml };
}

/**
 * Read the current CustomAgent Agent configuration and extract the model
 * for each supported role.
 */
export async function getCurrentCustomAgentRoles(): Promise<
  Record<string, { model: string; provider?: string; base_url?: string }>
> {
  const fs = await import("node:fs/promises");
  let config: any = {};

  try {
    const raw = await fs.readFile(getConfigPath(), "utf-8");
    config = yaml.load(raw) || {};
  } catch {
    return {};
  }

  const result: Record<string, any> = {};

  // default
  if (config.model?.default) {
    result.default = {
      model: config.model.default,
      provider: config.model.provider,
      base_url: config.model.base_url,
    };
  }

  // delegation
  if (config.delegation?.model) {
    result.delegation = {
      model: config.delegation.model,
      provider: config.delegation.provider,
      base_url: config.delegation.base_url,
    };
  }

  // auxiliary roles
  if (config.auxiliary && typeof config.auxiliary === "object") {
    for (const [role, val] of Object.entries(config.auxiliary)) {
      if (val && typeof val === "object" && (val as any).model) {
        result[role] = {
          model: (val as any).model,
          provider: (val as any).provider,
          base_url: (val as any).base_url,
        };
      }
    }
  }

  return result;
}
