import { CLINE_CONFIG } from "../constants/oauth";

type ClineTokenResponse = {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: string;
  data?: {
    accessToken?: string;
    refreshToken?: string;
    expiresAt?: string;
    userInfo?: { email?: string };
  };
};

export const cline = {
  config: CLINE_CONFIG,
  flowType: "authorization_code",
  buildAuthUrl: (config, redirectUri) => {
    const params = new URLSearchParams({
      client_type: "extension",
      callback_url: redirectUri,
      redirect_uri: redirectUri,
    });
    return `${config.authorizeUrl}?${params.toString()}`;
  },
  exchangeToken: async (config, code, redirectUri) => {
    try {
      // Cline embeds tokens as base64-encoded JSON in the auth code.
      // The code may be URL-encoded when pasted from the callback URL.
      let base64 = code;
      try {
        base64 = decodeURIComponent(base64);
      } catch {
        /* already decoded */
      }
      const padding = 4 - (base64.length % 4);
      if (padding !== 4) {
        base64 += "=".repeat(padding);
      }
      const decoded = Buffer.from(base64, "base64").toString("utf-8");
      const lastBrace = decoded.lastIndexOf("}");
      if (lastBrace === -1) {
        throw new Error("No JSON found in decoded code");
      }
      const jsonStr = decoded.substring(0, lastBrace + 1);
      const tokenData = JSON.parse(jsonStr);
      return {
        access_token: tokenData.accessToken,
        refresh_token: tokenData.refreshToken,
        email: tokenData.email,
        firstName: tokenData.firstName,
        lastName: tokenData.lastName,
        expires_at: tokenData.expiresAt,
      };
    } catch (e) {
      const response = await fetch(config.tokenExchangeUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          grant_type: "authorization_code",
          code: code,
          client_type: "extension",
          redirect_uri: redirectUri,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Cline token exchange failed: ${error}`);
      }

      const data = (await response.json()) as ClineTokenResponse;
      return {
        access_token: data.data?.accessToken || data.accessToken,
        refresh_token: data.data?.refreshToken || data.refreshToken,
        email: data.data?.userInfo?.email || "",
        expires_at: data.data?.expiresAt || data.expiresAt,
      };
    }
  },
  mapTokens: (tokens) => {
    const firstName = tokens.firstName || "";
    const lastName = tokens.lastName || "";
    const fullName = [firstName, lastName].filter(Boolean).join(" ").trim();
    return {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      // Guard the parse, not just the presence: a non-empty but unparseable
      // expires_at makes new Date(...).getTime() === NaN, so this expression
      // would yield NaN. persistOAuthConnection treats a falsy expiresIn as
      // "no expiry" (expiresAt=null), which marks the connection never-expiring
      // and the token is never refreshed. Fall back to the same default a
      // missing expires_at uses when the value does not parse to a finite time.
      expiresIn: (() => {
        if (!tokens.expires_at) return 3600;
        const ms = new Date(tokens.expires_at).getTime();
        return Number.isFinite(ms) ? Math.floor((ms - Date.now()) / 1000) : 3600;
      })(),
      // Use full name if available, fallback to email so UI shows a real label
      name: fullName || tokens.email || null,
      email: tokens.email,
      providerSpecificData: {
        firstName: tokens.firstName,
        lastName: tokens.lastName,
      },
    };
  },
};
