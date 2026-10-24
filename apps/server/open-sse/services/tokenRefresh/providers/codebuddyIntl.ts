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
      const errorText = await response.text();
      log?.error?.("TOKEN_REFRESH", "Failed to refresh CodeBuddy Intl token", {
        status: response.status,
        body: errorText.slice(0, 200),
      });
      return null;
    }
    const data = await response.json();
    if (data.code !== 0 || !data.data) {
      log?.error?.("TOKEN_REFRESH", "CodeBuddy Intl refresh returned error", {
        code: data.code,
      });
      return null;
    }
    return data.data;
  } catch (err) {
    log?.error?.("TOKEN_REFRESH", "CodeBuddy Intl refresh exception", {
      message: String(err),
    });
    return null;
  }
}
