/**
 * Shared CustomAgent home-directory resolver (#3628).
 *
 * The CustomAgent PowerShell installer (Windows) writes its default config under
 * `%LOCALAPPDATA%\customAgent`, exposed as the `CUSTOMAGENT_HOME` env var.  StyxRouter
 * previously hard-coded `~/.customAgent` everywhere, so the two config files never
 * met on Windows.
 *
 * IMPORTANT: the env var MUST be read at call-time (i.e. inside a function),
 * never at module-load time.  `TOOL_CONFIG_PATHS` in index.ts is evaluated
 * eagerly — any constant defined there would freeze the path at import.
 * That's why this module exports plain functions instead of constants.
 */

import path from "node:path";
import os from "node:os";

/**
 * Returns the CustomAgent home directory.
 *
 * Resolution order:
 *   1. `CUSTOMAGENT_HOME` env var (if non-empty)
 *   2. `~/.customAgent` (cross-platform fallback)
 *
 * Reads `process.env.CUSTOMAGENT_HOME` every call so tests can set/unset the var
 * without module-cache interference.
 */
export function getCustomAgentHome(): string {
  const override = (process.env.CUSTOMAGENT_HOME || "").trim();
  return override || path.join(os.homedir(), ".customAgent");
}

/**
 * Returns the canonical path to the CustomAgent Agent `config.yaml`.
 * Always delegates to `getCustomAgentHome()` so it picks up `CUSTOMAGENT_HOME` at
 * call-time.
 */
export function getCustomAgentConfigPath(): string {
  return path.join(getCustomAgentHome(), "config.yaml");
}
