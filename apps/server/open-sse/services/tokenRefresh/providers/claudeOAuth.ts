// @ts-nocheck
// Extracted from open-sse/services/tokenRefresh.ts — see ../shared.ts for
// provenance notes (ported idea from KooshaPari's PR #7338, redone on tip).
import { PROVIDERS, OAUTH_ENDPOINTS } from "../../../config/constants.ts";
import { runWithProxyContext } from "../../../utils/proxyFetch.ts";
import { buildFormParams, readRefreshErrorBody } from "../shared.ts";
import { parseSafeRefreshResponse } from "../importSafeResponse.ts";

/**
 * Specialized refresh for Claude OAuth tokens
 */
export async function refreshClaudeOAuthToken(refreshToken, log, proxyConfig: unknown = null) {
  try {
    // Standard OAuth2 token refresh uses form-urlencoded (not JSON)
    const params = buildFormParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: PROVIDERS.claude.clientId,
    });

    const response = await runWithProxyContext(proxyConfig, () =>
      fetch(OAUTH_ENDPOINTS.anthropic.token, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
          "anthropic-beta": "oauth-2025-04-20",
        },
        body: params.toString(),
      })
    );

    if (!response.ok) {
      // Read + classify the body ONCE, shape-agnostic. A proxy/MITM can deliver
      // the invalid_grant 400 as a JSON string, a double-encoded string, a
      // nested {error:{code}}, or raw text — all must yield the sentinel so the
      // HealthCheck deactivates instead of looping every 60s.
      const { code } = await readRefreshErrorBody(response);
      log?.error?.("TOKEN_REFRESH", "Failed to refresh Claude OAuth token", {
        status: response.status,
      });
      if (code === "invalid_grant" || code === "invalid_request") {
        return { error: "unrecoverable_refresh_error", code };
      }
      return null;
    }

    const tokens = parseSafeRefreshResponse(await response.json(), refreshToken);
    if (!tokens) return null;

    log?.info?.("TOKEN_REFRESH", "Successfully refreshed Claude OAuth token", {
      hasNewAccessToken: true,
      hasNewRefreshToken: tokens.refreshToken !== refreshToken,
      expiresIn: tokens.expiresIn,
    });

    return tokens;
  } catch {
    log?.error?.("TOKEN_REFRESH", "Network error refreshing Claude token");
    return null;
  }
}
