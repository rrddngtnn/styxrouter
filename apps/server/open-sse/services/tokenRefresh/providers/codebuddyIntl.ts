import { runWithProxyContext } from "../../../utils/proxyFetch.ts";
import type { RefreshLogger } from "../shared.ts";

/**
 * CodeBuddy International token refresh — POST refreshUrl with
 * the refresh token in X-Refresh-Token header.
 */
export async function refreshCodebuddyIntlToken(
  refreshToken: string,
  log: RefreshLogger,
  proxyConfig: unknown = null
) {
  if (!refreshToken) return null;
  const { CODEBUDDY_INTL_CONFIG } = await import("@/lib/oauth/constants/oauth");
  const oauth = CODEBUDDY_INTL_CONFIG;
  try {
    const response = await runWithProxyContext(proxyConfig, () =>
      fetch(oauth.refreshUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "User-Agent": oauth.userAgent,
          "X-Requested-With": "XMLHttpRequest",
          "X-Domain": "codebuddy.ai",
          "X-Refresh-Token": refreshToken,
          "X-Auth-Refresh-Source": "plugin",
          "X-Product": "SaaS",
        },
        body: "{}",
      })
    );
    if (!response.ok) {
      // Upstream error bodies are untrusted and can contain submitted credentials.
      log?.error?.("TOKEN_REFRESH", "Failed to refresh CodeBuddy Intl token", {
        status: response.status,
      });
      return null;
    }
    const data = await response.json();
    if (data.code !== 0 || typeof data.data?.accessToken !== "string" || !data.data.accessToken.trim()) {
      log?.error?.("TOKEN_REFRESH", "CodeBuddy Intl refresh returned an error");
      return null;
    }
    return data.data;
  } catch {
    log?.error?.("TOKEN_REFRESH", "CodeBuddy Intl refresh exception");
    return null;
  }
}
