// Compatibility baseline from the official openai/codex rust-v0.167.1 release.
// Deployments may explicitly override it with CODEX_CLIENT_VERSION.
export const DEFAULT_CODEX_CLIENT_VERSION = "0.167.1";
export const CODEX_CLI_RS_ORIGINATOR = "codex_cli_rs";

export function getCodexCliRsHeaders(
  version = DEFAULT_CODEX_CLIENT_VERSION
): Record<string, string> {
  return {
    "User-Agent": `${CODEX_CLI_RS_ORIGINATOR}/${version}`,
    originator: CODEX_CLI_RS_ORIGINATOR,
  };
}
