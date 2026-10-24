/**
 * MCP Authorization Scopes — Defines permission scopes for each MCP tool.
 *
 * Each tool requires specific scopes to execute. API keys can be configured
 * with a subset of scopes to limit tool access (least-privilege).
 */

// ============ Scope Definitions ============

/** All available MCP scopes */
export const MCP_SCOPE_LIST = [
  "read:health",
  "read:combos",
  "write:combos",
  "read:quota",
  "read:usage",
  "read:models",
  "read:radar",
  "execute:completions",
  "execute:search",
  "write:budget",
  "write:resilience",
  "pricing:write",
  "read:cache",
  "write:cache",
  "read:compression",
  "write:compression",
  "read:proxies",
] as const;

export type McpScope = (typeof MCP_SCOPE_LIST)[number];

// ============ Tool → Scope Mapping ============

/** Maps each MCP tool to its required scopes */
export const MCP_TOOL_SCOPES: Record<string, readonly McpScope[]> = {
  // Phase 1: Essential Tools
  styx_get_health: ["read:health"],
  styx_list_combos: ["read:combos"],
  styx_get_combo_metrics: ["read:combos"],
  styx_switch_combo: ["write:combos"],
  styx_check_quota: ["read:quota"],
  styx_route_request: ["execute:completions"],
  styx_web_search: ["execute:search"],
  styx_x_search: ["execute:search"],
  styx_web_fetch: ["execute:search"],
  styx_cost_report: ["read:usage"],
  styx_list_models_catalog: ["read:models"],
  styx_radar_catalog: ["read:radar"],

  // Phase 2: Advanced Tools
  styx_simulate_route: ["read:health", "read:combos"],
  styx_set_budget_guard: ["write:budget"],
  styx_set_resilience_profile: ["write:resilience"],
  styx_test_combo: ["execute:completions", "read:combos"],
  styx_get_provider_metrics: ["read:health"],
  styx_best_combo_for_task: ["read:combos", "read:health"],
  styx_explain_route: ["read:health", "read:usage"],
  styx_get_session_snapshot: ["read:usage"],
  styx_db_health_check: ["read:health", "write:resilience"],
  styx_sync_pricing: ["pricing:write"],
  styx_cache_stats: ["read:cache"],
  styx_cache_flush: ["write:cache"],
  styx_compression_status: ["read:compression"],
  styx_compression_configure: ["write:compression"],
  styx_set_compression_engine: ["write:compression"],
  styx_list_compression_combos: ["read:compression"],
  styx_compression_combo_stats: ["read:compression"],
  styx_ccr_store: ["write:compression"],
  styx_ccr_retrieve: ["read:compression"],
  styx_ccr_inspect: ["read:compression"],
  styx_ccr_list: ["read:compression"],
  styx_ccr_delete: ["write:compression"],
  styx_ccr_stats: ["read:compression"],
  styx_oneproxy_fetch: ["read:proxies"],
  styx_oneproxy_rotate: ["read:proxies"],
  styx_oneproxy_stats: ["read:proxies"],

  // Web-session pool observability (read) + lifecycle (write)
  styx_pool_status: ["read:health"],
  styx_pool_sessions: ["read:health"],
  styx_pool_health: ["read:health"],
  styx_pool_reset: ["write:resilience"],
  styx_pool_warm: ["write:resilience"],
  // Stealth browser pool observability (#3368 PR7)
  styx_browser_pool_status: ["read:health"],
} as const;
