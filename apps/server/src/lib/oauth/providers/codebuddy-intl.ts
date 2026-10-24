import { CODEBUDDY_INTL_CONFIG } from "../constants/oauth";

/**
 * CodeBuddy International (codebuddy.ai) — custom device-auth flow.
 *
 *   1. POST stateUrl → { code: 0, data: { state, authUrl } }
 *   2. Open authUrl in the browser
 *   3. GET tokenUrl?state=<state> until { code: 0, data.accessToken } (11217 = pending)
 *
 * Same flow shape as CN, different host.
 */
type CodeBuddyConfig = typeof CODEBUDDY_INTL_CONFIG;

interface CodeBuddyDeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
}

interface CodeBuddyTokens {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in?: number;
}

interface CodeBuddyPollResult {
  ok: boolean;
  data: Record<string, unknown> | CodeBuddyTokens;
}

export const codebuddyIntl = {
  config: CODEBUDDY_INTL_CONFIG,
  flowType: "device_code" as const,

  requestDeviceCode: async (config: CodeBuddyConfig): Promise<CodeBuddyDeviceCodeResponse> => {
    const stateUrl = `${config.stateUrl}?platform=${encodeURIComponent(config.platform)}`;
    const response = await fetch(stateUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": config.userAgent,
        "X-Requested-With": "XMLHttpRequest",
        "X-Domain": "codebuddy.ai",
        "X-No-Authorization": "true",
        "X-No-User-Id": "true",
        "X-Product": "SaaS",
      },
      body: JSON.stringify({ platform: config.platform }),
    });
    if (!response.ok) {
      const err = await response.text();
      throw new Error(`CodeBuddy Intl device code request failed (${response.status}): ${err}`);
    }
    const result = await response.json();
    if (result.code !== 0 || !result.data) {
      throw new Error(`CodeBuddy Intl device code unexpected response: ${JSON.stringify(result)}`);
    }
    return {
      device_code: result.data.state,
      user_code: result.data.state,
      verification_uri: result.data.authUrl,
      verification_uri_complete: result.data.authUrl,
      expires_in: 300,
      interval: config.pollInterval / 1000,
    };
  },

  pollForToken: async (
    config: CodeBuddyConfig,
    deviceCode: string
  ): Promise<CodeBuddyPollResult> => {
    const tokenUrl = `${config.tokenUrl}?state=${encodeURIComponent(deviceCode)}`;
    const response = await fetch(tokenUrl, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": config.userAgent,
        "X-Requested-With": "XMLHttpRequest",
        "X-Domain": "codebuddy.ai",
        "X-No-Authorization": "true",
        "X-No-User-Id": "true",
        "X-Product": "SaaS",
      },
    });
    if (!response.ok) return { ok: false, data: {} };
    const result = await response.json();
    if (result.code === 11217) return { ok: false, data: result.data || {} };
    if (result.code === 0 && result.data?.accessToken) {
      return {
        ok: true,
        data: {
          access_token: result.data.accessToken,
          refresh_token: result.data.refreshToken || "",
          token_type: "Bearer",
          expires_in: result.data.expiresIn,
        },
      };
    }
    return { ok: false, data: result.data || {} };
  },
};
