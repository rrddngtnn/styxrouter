// OAuth response fields are untrusted; never log or persist arbitrary payload values.
export function parseSafeRefreshResponse(value: unknown, previousRefreshToken: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const data = value as Record<string, unknown>;
  const validToken = (token: unknown): token is string =>
    typeof token === "string" && token.length > 0 && token.length <= 16384 &&
    !/[\s\x00-\x1f\x7f]/.test(token) && !token.startsWith("enc:v1:");
  if (!validToken(data.access_token)) return null;
  if (data.refresh_token != null && !validToken(data.refresh_token)) return null;
  if (data.expires_in != null && (typeof data.expires_in !== "number" || !Number.isFinite(data.expires_in) || data.expires_in <= 0 || data.expires_in > 315360000)) return null;
  return {
    accessToken: data.access_token,
    refreshToken: (data.refresh_token as string | undefined | null) ?? previousRefreshToken,
    ...(data.expires_in == null ? {} : { expiresIn: data.expires_in as number }),
  };
}
