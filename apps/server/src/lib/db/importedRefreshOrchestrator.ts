import type { SqliteAdapter } from "./adapters/types";
import { claimImportedRefresh, finishImportedRefresh } from "./importedRefreshClaim";
import { runWithProxyContext } from "../../../open-sse/utils/proxyFetch";

type Rotation = { accessToken: string; refreshToken: string; expiresIn?: number };
async function exchangeCodebuddyCn(refresh: string): Promise<Rotation | null> {
  const { CODEBUDDY_CN_CONFIG: oauth } = await import("@/lib/oauth/constants/oauth");
  const response = await runWithProxyContext(null, () => fetch(oauth.refreshUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json", Accept: "application/json",
      "User-Agent": oauth.userAgent, "X-Requested-With": "XMLHttpRequest",
      "X-Domain": "copilot.tencent.com", "X-Refresh-Token": refresh,
      "X-Auth-Refresh-Source": "plugin", "X-Product": "SaaS",
    },
    body: "{}",
  }));
  if (!response.ok) return null;
  const data = await response.json();
  return data?.code === 0 ? data.data : null;
}
// Deliberately not wired into dispatch: all other entry points must remain blocked.
export async function refreshImportedCodebuddyCn(
  db: SqliteAdapter, id: string, expectedRefresh: string,
  exchange: (refresh: string) => Promise<Rotation | null> = exchangeCodebuddyCn
): Promise<Rotation & { expiresAt: string | null }> {
  try {
    const claim = claimImportedRefresh(db, id, expectedRefresh, "codebuddy-cn");
    const result = await exchange(expectedRefresh);
    if (!result || typeof result.accessToken !== "string" || !result.accessToken || typeof result.refreshToken !== "string" || !result.refreshToken) throw new Error();
    let expiresAt: string | null = null;
    if (result.expiresIn != null) {
      if (typeof result.expiresIn !== "number" || !Number.isFinite(result.expiresIn) || result.expiresIn <= 0) throw new Error();
      expiresAt = new Date(Date.now() + result.expiresIn * 1000).toISOString();
    }
    finishImportedRefresh(db, id, claim, expectedRefresh, result.accessToken, result.refreshToken, expiresAt, "codebuddy-cn");
    return { accessToken: result.accessToken, refreshToken: result.refreshToken, expiresIn: result.expiresIn, expiresAt };
  } catch {
    throw new Error("Imported refresh unavailable; re-authenticate the connection");
  }
}
