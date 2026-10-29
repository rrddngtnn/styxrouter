type CopilotToken = {
  token: string;
  expires_at: string | number;
  endpoints?: { proxy?: string; api?: string };
};

type GithubToken = { access_token: string; refresh_token?: string; expires_in: number };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function parseCopilotToken(value: unknown): CopilotToken | null {
  if (!isRecord(value) || typeof value.token !== "string" || !value.token ||
      !(typeof value.expires_at === "string" || typeof value.expires_at === "number")) return null;
  const endpoints = isRecord(value.endpoints) ? {
    ...(typeof value.endpoints.proxy === "string" ? { proxy: value.endpoints.proxy } : {}),
    ...(typeof value.endpoints.api === "string" ? { api: value.endpoints.api } : {}),
  } : undefined;
  return { token: value.token, expires_at: value.expires_at, ...(endpoints ? { endpoints } : {}) };
}

export function parseGithubToken(value: unknown): GithubToken | null {
  if (!isRecord(value) || typeof value.access_token !== "string" || !value.access_token ||
      typeof value.expires_in !== "number") return null;
  return { access_token: value.access_token, expires_in: value.expires_in,
    ...(typeof value.refresh_token === "string" ? { refresh_token: value.refresh_token } : {}) };
}
