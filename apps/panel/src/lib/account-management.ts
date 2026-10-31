export type BulkAction = "enable" | "disable" | "cooldown" | "test" | "delete";
export interface BulkResult { id: string; ok: boolean; message: string }
export function selectedAccounts(accounts: { id: string }[], selected: Set<string>) {
  return accounts.filter(a => selected.has(a.id)).map(a => a.id);
}
export function updateVisibleAccountSelection(selected: Set<string>, visible: { id: string }[], checked: boolean): Set<string> {
  const next = new Set(selected);
  for (const account of visible) {
    if (checked) next.add(account.id);
    else next.delete(account.id);
  }
  return next;
}
export async function runBulk(ids: string[], action: BulkAction, request: (method: "PATCH" | "POST" | "DELETE", path: string, body?: { isActive: boolean }) => Promise<unknown>): Promise<BulkResult[]> {
  const results: BulkResult[] = [];
  for (const id of ids) {
    const path = `/api/connections/${encodeURIComponent(id)}`;
    try {
      const out = await (action === "enable" || action === "disable"
        ? request("PATCH", path, { isActive: action === "enable" })
        : request(action === "delete" ? "DELETE" : "POST", path + (action === "test" ? "/test" : action === "cooldown" ? "/release-cooldown" : ""), undefined));
      const ok = action !== "test" || (typeof out === "object" && out !== null && "ok" in out && out.ok === true);
      results.push({ id, ok, message: ok ? "Succeeded" : "Test rejected" });
    } catch {
      results.push({ id, ok: false, message: "Request failed; retry this account" });
    }
  }
  return results;
}

export type AccountTab = "oauth" | "apikey" | "custom";
interface AccountIdentity { id: string; provider: string; name?: string | null; authType?: string }
interface ProviderIdentity { id: string; name?: string; vendor?: string; authType?: string; authModes?: string[] }
interface NodeIdentity {
  id: string;
  name: string;
  prefix: string | null;
  type?: string;
  apiType?: string | null;
  baseUrl?: string | null;
}

export interface ProviderTarget<P = ProviderIdentity, N = NodeIdentity> {
  id: string;
  label: string;
  code: string;
  badge: string;
  isCustomNode: boolean;
  canOauth: boolean;
  canApiKey: boolean;
  defaultTab: AccountTab;
  provider?: P;
  node?: N;
}

export function resolveProviderTarget<P extends ProviderIdentity, N extends NodeIdentity>(
  providerId: string,
  providers: P[],
  nodes: N[],
): ProviderTarget<P, N> | null {
  const provider = providers.find((p) => p.id === providerId);
  if (provider) {
    const modes = provider.authModes ?? (provider.authType ? [provider.authType] : []);
    const canOauth = modes.includes("oauth");
    const canApiKey = modes.includes("apikey");
    return {
      id: provider.id,
      label: provider.name ?? provider.id,
      code: provider.id,
      badge: provider.vendor ?? "—",
      isCustomNode: false,
      canOauth,
      canApiKey,
      defaultTab: canOauth ? "oauth" : "apikey",
      provider,
    };
  }

  const node = nodes.find((n) => n.id === providerId);
  if (node) {
    return {
      id: node.id,
      label: node.name,
      code: node.prefix ? `${node.prefix}/*` : node.id.slice(0, 18),
      badge: (node.type ?? "custom").replace("-compatible", ""),
      isCustomNode: true,
      canOauth: false,
      canApiKey: true,
      defaultTab: "custom",
      node,
    };
  }

  return null;
}

export function normalizeAccountAuthBucket(authType?: string | null): "oauth" | "apikey" {
  return authType === "apikey" || authType === "api_key" ? "apikey" : "oauth";
}

export function formatCredentialExpiryHint(tokenExpiresAt?: string | null, now = Date.now()): string | null {
  if (!tokenExpiresAt) return null;
  const ms = Date.parse(tokenExpiresAt);
  if (!Number.isFinite(ms)) return null;
  const diff = ms - now;
  if (diff <= 0) return "token expired";
  const sevenDaysMs = 7 * 86_400_000;
  if (diff > sevenDaysMs) return null;
  const hours = Math.ceil(diff / 3_600_000);
  if (hours < 24) return `expires in ${hours}h`;
  return `expires in ${Math.ceil(diff / 86_400_000)}d`;
}

export function accountsForProvider<T extends AccountIdentity>(
  accounts: T[],
  providerId: string,
  authTab?: AccountTab,
): T[] {
  return accounts
    .filter((a) => {
      if (a.provider !== providerId) return false;
      if (!authTab || authTab === "custom") return true;
      return normalizeAccountAuthBucket(a.authType) === authTab;
    })
    .sort((a, b) => String(a.name ?? a.id).localeCompare(String(b.name ?? b.id)));
}

export function filterProviderAccounts<T extends Pick<AccountIdentity, "id" | "name">>(accounts: T[], search: string): T[] {
  const query = search.trim().toLocaleLowerCase();
  return query ? accounts.filter((account) => (account.name ?? account.id.slice(0, 8)).toLocaleLowerCase().includes(query)) : accounts;
}

export function groupAccounts<T extends AccountIdentity>(accounts: T[], providers: ProviderIdentity[], nodes: NodeIdentity[], tab: AccountTab) {
  const groups = new Map<string, { id: string; label: string; accounts: T[] }>();
  for (const account of accounts) {
    const node = nodes.find(n => n.id === account.provider);
    const provider = providers.find(p => p.id === account.provider);
    const auth = account.authType === "api_key" ? "apikey" : account.authType;
    if (node ? tab !== "custom" : tab === "custom" || (auth ? auth !== tab : !(provider?.authModes ?? [provider?.authType]).includes(tab))) continue;
    const label = node ? node.name + (node.prefix ? ` (${node.prefix})` : "") : provider?.name ?? account.provider;
    const group = groups.get(account.provider) ?? { id: account.provider, label, accounts: [] };
    group.accounts.push(account);
    groups.set(group.id, group);
  }
  return [...groups.values()].sort((a, b) => a.label.localeCompare(b.label));
}
