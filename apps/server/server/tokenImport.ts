// Token import accepts only explicitly configured registry targets; it never uses
// export URLs for network requests. Raw credentials stay out of response objects.
import { randomUUID } from "node:crypto";
import { REGISTRY } from "../open-sse/config/providers/index.ts";
import { getDbInstance } from "../src/lib/db/core.ts";
import { backupDbFile } from "../src/lib/db/backup.ts";
import { persistTokenImport } from "./tokenImportPersistence.ts";
import { ImportCredentialConflict } from "../src/lib/db/importedCredential.ts";
import { looksLikeUuid } from "../open-sse/services/promptql/jwt.ts";

const registry = REGISTRY as Record<string, any>;
const wrappers = ["account", "tokens", "auth", "credentials"];
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const canonical = (s: string) => {
  const entry = Object.hasOwn(registry, s) ? registry[s] : undefined;
  if (entry) return entry.id as string;
  const match = Object.values(registry).find((e: any) => e.alias === s);
  return match?.id as string | undefined;
};
// Auth modes do not describe executor requirements: a web cookie, GitHub's
// exchange token, and a bearer access token are not interchangeable. Only
// contracts audited here are enabled; new providers fail closed until reviewed.
const oauthAccess = new Set(["codebuddy-cn", "codebuddy-intl", "claude", "codex", "kimi-coding", "kimi-web", "xai-oauth", "kiro", "promptql"]);
const specialApiKeys = new Set(["glm", "glmt", "qoder", "kimi", "moonshot", "xai", "opencode", "opencode-zen", "opencode-go", "cheaperinference"]);
const safeRefresh = new Set<string>();
// Informational only: these contracts remain disabled until their complete
// storage, dispatch and rejection paths have been verified independently.
const unsupportedContracts: Record<string, { credentialFormat: string; requiredData: string[]; reason: string }> = {
  lmarena: { credentialFormat: "web-session", requiredData: ["cookies"], reason: "Arena requires browser session cookies and may require a challenge token" },
  "claude-web": { credentialFormat: "web-session", requiredData: ["sessionKey", "organizationId"], reason: "Claude Web requires a session cookie and an organization identifier or discovery" },
  "gemini-web": { credentialFormat: "web-session", requiredData: ["cookies"], reason: "Gemini Web requires browser cookies and can rotate them" },
  "chatgpt-web-codex": { credentialFormat: "web-session", requiredData: ["cookies or browser storage state", "optional runtime key"], reason: "ChatGPT Web requires browser session credentials" },
  github: { credentialFormat: "token-exchange", requiredData: ["GitHub token", "Copilot token exchange"], reason: "GitHub Copilot requires a separate Copilot token exchange" },
  antigravity: { credentialFormat: "oauth-project", requiredData: ["access token", "Google Cloud project"], reason: "Antigravity may require Google project configuration not imported here" },

  promptql: { credentialFormat: "project-jwt", requiredData: ["playground JWT", "project ID"], reason: "PromptQL chat requires a playground JWT and project identity; DDN project tokens alone cannot dispatch chat" },
  zcode: { credentialFormat: "local-cli", requiredData: ["local CLI session"], reason: "ZCode uses a local CLI session rather than imported bearer credentials" },
  auggie: { credentialFormat: "local-cli", requiredData: ["local CLI session"], reason: "Auggie uses a local CLI session rather than imported bearer credentials" },
  "codex-app-server": { credentialFormat: "local-cli", requiredData: ["local CLI session"], reason: "Codex app-server uses local CLI authentication rather than imported bearer credentials" },
};
function compatibility(id: string, entry: any) {
  const oauth = oauthAccess.has(id);
  const apiKey = entry.authType === "apikey" && (specialApiKeys.has(id) ||
    ((!entry.executor || entry.executor === "default") && ["bearer", "x-api-key", "x-goog-api-key"].includes(entry.authHeader)));
  const supported = oauth || apiKey;
  const details = unsupportedContracts[id];
  const reason = supported ? null : details?.reason || (entry.authHeader === "cookie" || id.endsWith("-web")
    ? "Web session or cookie credentials require a provider-specific import flow"
    : "Credential contract has not been verified for generic token import");
  return { id, supported, reason, ...(id === "kiro" ? { credentialFormat: "oauth-account", requiredData: ["access token", "authentication method", "profile ARN for external IdP"] } : id === "promptql" ? {credentialFormat: "project-jwt", requiredData: ["playground JWT", "project ID"]} : supported ? {} : { credentialFormat: details?.credentialFormat || "unverified", requiredData: details?.requiredData || [] }), access: supported, accessRefresh: oauth && id !== "kimi-web" && id !== "kiro" && id !== "promptql", json: supported,
    refreshReason: oauth && !safeRefresh.has(id) ? "Imported refresh is disabled: cross-process token rotation is not protected; re-authenticate using the provider login" : apiKey && !oauth ? "API-key credentials do not accept OAuth refresh tokens" : null,
    authType: oauth ? "oauth" : apiKey ? "apikey" : null };
}
export function tokenImportProviders() {
  return Object.entries(registry).filter(([id, e]) => id === e.id).map(([id, e]) => compatibility(id, e));
}
function hostProviders(value: unknown): string[] {
  if (typeof value !== "string" || value.length > 2048) return [];
  try {
    const url = new URL(value);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return [];
    const host = url.hostname.toLowerCase();
    return [...new Set(Object.entries(registry).filter(([id, e]) => id === e.id && typeof e.baseUrl === "string" && (() => { try { return new URL(e.baseUrl).hostname.toLowerCase() === host; } catch { return false; } })()).map(([id]) => id))];
  } catch { return []; }
}
function fields(list: Record<string, unknown>[], keys: string[]) {
  return list.flatMap((item) => keys.filter((key) => Object.hasOwn(item, key)).map((key) => ({ item, value: item[key] })));
}
function layers(input: Record<string, unknown>): Record<string, unknown>[] {
  const out = [input];
  for (let i = 0; i < out.length; i++) for (const key of wrappers) {
    const value = out[i][key];
    if (isObject(value) && !out.includes(value)) {
      if (out.length >= 40) return [];
      out.push(value);
    }
  }
  return out;
}
function containsLayer(root: Record<string, unknown>, target: Record<string, unknown>): boolean {
  const nested = layers(root);
  return nested.length > 0 && nested.includes(target);
}
function related(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  return containsLayer(a, b) || containsLayer(b, a);
}
function token(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim().replace(/^Bearer\s+/i, "");
  return t.length > 0 && t.length <= 16384 && !/[\s\x00-\x1f\x7f-\uffff]/.test(t) && !t.startsWith("enc:v1:") ? t : null;
}
function timestamp(value: unknown): number | false {
  let ms: number;
  if (typeof value === "number" || (typeof value === "string" && /^\d+(?:\.\d+)?$/.test(value))) {
    const n = Number(value); ms = n < 1e12 ? n * 1000 : n;
  } else if (typeof value === "string") ms = Date.parse(value);
  else return false;
  return Number.isFinite(ms) && ms >= 0 && ms <= 8640000000000000 ? ms : false;
}
function expiry(list: Record<string, unknown>[], access: string, opaque = false): string | null | false {
  const times: number[] = [];
  for (const { value: absolute } of fields(list, ["expires_at", "expiresAt", "exp"])) {
    const ms = timestamp(absolute);
    if (ms === false) return false;
    times.push(ms);
  }
  const durations = fields(list, ["expires_in", "expiresIn"]);
  const issued = fields(list, ["issued_at", "issuedAt"]);
  if (durations.length) {
    if (!issued.length || durations.some((d) => issued.some((i) => !related(d.item, i.item)))) return false;
    for (const { value } of durations) {
      if (!(typeof value === "number" || (typeof value === "string" && /^\d+(?:\.\d+)?$/.test(value)))) return false;
      const seconds = Number(value);
      if (!Number.isFinite(seconds) || seconds < 0 || seconds * 1000 > 8640000000000000) return false;
      for (const entry of issued) {
        const start = timestamp(entry.value);
        if (start === false || start + seconds * 1000 > 8640000000000000) return false;
        times.push(start + seconds * 1000);
      }
    }
  }
  if (!opaque) try {
    const payload = JSON.parse(Buffer.from(access.split(".")[1], "base64url").toString("utf8"));
    if (isObject(payload) && Object.hasOwn(payload, "exp")) {
      if (typeof payload.exp !== "number" || !Number.isFinite(payload.exp) || payload.exp < 0 || payload.exp * 1000 > 8640000000000000) return false;
      times.push(payload.exp * 1000);
    }
  } catch { /* opaque token */ }
  return times.length ? new Date(Math.min(...times)).toISOString() : null;
}
type KiroMetadata = { authMethod: "social" | "external_idp"; profileArn?: string; region?: string };
type Prepared = { view: Record<string, unknown>; access?: string; refresh?: string; authType?: string; workspaceId?: string; kiroMetadata?: KiroMetadata; promptqlProjectId?: string };
function prepare(value: unknown, fallback: string, index: number): Prepared {
  const fail = (error: string): Prepared => ({ view: { index, valid: false, error } });
  if (!isObject(value)) return fail("Entry must be an object");
  const list = layers(value);
  if (!list.length) return fail("Too many nested wrappers");
  const explicitFields = fields(list, ["provider", "providerId", "type"]);
  const explicitProviders = explicitFields.map(({ value }) => typeof value === "string" ? canonical(value) : undefined);
  if (explicitProviders.some((id) => !id)) return fail("Unknown provider");
  if (new Set(explicitProviders).size > 1) return fail("Conflicting providers");
  const hostFields = fields(list, ["baseUrl", "api_base", "url"]);
  const accesses = fields(list, ["access_token", "accessToken", "token"]);
  if ([...explicitFields, ...hostFields].some(({ item }) => accesses.some((accessField) => !containsLayer(item, accessField.item) && !containsLayer(accessField.item, item)))) return fail("Ambiguous provider binding");
  const hosts = hostFields.map(({ value }) => hostProviders(value));
  if (hosts.some((ids) => !ids.length)) return fail("Unknown provider host");
  const explicit = explicitProviders[0];
  const hostCandidates = hosts.length ? hosts.reduce((a, b) => a.filter((id) => b.includes(id))) : [];
  if (hosts.length && !hostCandidates.length) return fail("Conflicting provider hosts");
  if (explicit && hosts.length && !hostCandidates.includes(explicit)) return fail("Conflicting provider and host");
  if (!explicit && hosts.length && hostCandidates.length !== 1) return fail("Ambiguous provider host");
  const provider = explicit || hostCandidates[0] || canonical(fallback);
  const providerSource = explicit ? "explicit" : hosts.length ? "host" : "fallback";
  if (!provider || !Object.hasOwn(registry, provider)) return fail("Unknown provider");
  const contract = compatibility(provider, registry[provider]);
  if (!contract.supported) return fail(contract.reason || "Provider does not support token credentials");
  const refreshes = fields(list, ["refresh_token", "refreshToken"]);
  const accessValues = accesses.map(({ value }) => token(value));
  if (!accessValues.length || accessValues.some((t) => !t)) return fail("A valid access token is required");
  if (new Set(accessValues).size !== 1) return fail("Ambiguous access tokens");
  if (accesses.some((a) => accesses.some((b) => !related(a.item, b.item)))) return fail("Ambiguous access tokens");
  const access = accessValues[0]!;
  const refreshValues = refreshes.map(({ value }) => token(value));
  if (refreshValues.some((t) => !t)) return fail("Invalid refresh token");
  if (new Set(refreshValues).size > 1 || (refreshes.length && (new Set(accesses.map((f) => f.item)).size !== 1 || new Set(refreshes.map((f) => f.item)).size !== 1 || accesses[0].item !== refreshes[0].item))) return fail("Ambiguous token pair");
  const refresh = refreshValues[0] || null;
  const authType = contract.authType!;
  if (refresh && !contract.accessRefresh) return fail(contract.refreshReason || "Provider does not support OAuth refresh tokens");
  const expiryFields = fields(list, ["expires_at", "expiresAt", "exp", "expires_in", "expiresIn", "issued_at", "issuedAt"]);
  const bindingFields = [...accesses, ...refreshes, ...explicitFields, ...hostFields, ...expiryFields];
  if (bindingFields.some((a) => bindingFields.some((b) => !related(a.item, b.item)))) return fail("Ambiguous credential metadata binding");
  if (fields(list, ["expires_in", "expiresIn"]).length && !fields(list, ["issued_at", "issuedAt"]).length) return fail("Relative expiry is unsupported without an issuance timestamp; provide an absolute expiry");
  const expiresAt = expiry(list, access, provider === "promptql");
  if (expiresAt === false) return fail("Invalid expiry");
  let workspaceId: string | undefined;
  if (provider === "codex") {
    const names = ["account_id", "accountId", "chatgpt_account_id", "chatgptAccountId", "workspace_id", "workspaceId"];
    const ids = list.flatMap((item) => [
      ...fields([item], names),
      ...(isObject(item.providerSpecificData) ? fields([item.providerSpecificData], names).map(({ value }) => ({ item, value })) : []),
    ]);
    if (ids.some(({ item }) => accesses.some((accessField) => !containsLayer(item, accessField.item) && !containsLayer(accessField.item, item)))) return fail("Ambiguous Codex workspace binding");
    if (ids.some(({ value }) => typeof value !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(value))) return fail("Invalid Codex workspace identifier");
    const values = ids.map(({ value }) => value as string);
    if (new Set(values).size > 1) return fail("Conflicting Codex workspace identifiers");
    workspaceId = values[0];
  }
  let kiroMetadata: KiroMetadata | undefined;
  if (provider === "kiro") {
    if (refresh) return fail("Kiro refresh-token import is not supported");
    const metadataFields = (names: string[]) => list.flatMap(item => [
      ...fields([item], names),
      ...(isObject(item.providerSpecificData) ? fields([item.providerSpecificData], names).map(({ value }) => ({ item, value })) : []),
    ]);
    const methods = metadataFields(["authMethod", "auth_method"]);
    const arns = metadataFields(["profileArn", "profile_arn"]);
    const regions = metadataFields(["region"]);
    const kiroFields = [...methods, ...arns, ...regions];
    if (kiroFields.some(a => [...bindingFields, ...kiroFields].some(b => !related(a.item, b.item)))) return fail("Ambiguous Kiro metadata binding");
    const unique = (entries: { value: unknown }[]) => new Set(entries.map(e => e.value)).size <= 1;
    if (!methods.length || !unique(methods) || typeof methods[0].value !== "string" || !["social", "external_idp"].includes(methods[0].value)) return fail("Unsupported Kiro authentication method");
    if (!unique(arns) || arns.some(({ value }) => typeof value !== "string" || !/^arn:aws:codewhisperer:(?:us-east-1|eu-central-1):\d{12}:profile\/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(value))) return fail("Invalid Kiro profile ARN");
    if (!unique(regions) || regions.some(({ value }) => typeof value !== "string" || !/^[a-z]{2}-[a-z]+-\d{1,2}$/.test(value))) return fail("Invalid Kiro region");
    if (methods[0].value === "external_idp" && !arns.length) return fail("Kiro external IdP requires a profile ARN");
    kiroMetadata = { authMethod: methods[0].value as KiroMetadata["authMethod"], ...(arns.length ? { profileArn: arns[0].value as string } : {}), ...(regions.length ? { region: regions[0].value as string } : {}) };
  }
  let promptqlProjectId: string | undefined;
  if (provider === "promptql") {
    const ids = list.flatMap(item => [...fields([item], ["projectId", "project_id", "x-hasura-project-id"]), ...(isObject(item.providerSpecificData) ? fields([item.providerSpecificData], ["projectId", "project_id", "x-hasura-project-id"]).map(({value}) => ({item, value})) : [])]);
    if (ids.some(a => [...bindingFields, ...ids].some(b => !related(a.item, b.item)))) return fail("Ambiguous PromptQL project binding");
    if (!ids.length || ids.some(({value}) => typeof value !== "string" || !looksLikeUuid(value) || value !== value.trim())) return fail("A valid PromptQL project ID is required");
    const values = ids.map(({value}) => (value as string).toLowerCase());
    if (new Set(values).size !== 1) return fail("Conflicting PromptQL project IDs");
    promptqlProjectId = values[0];
  }
  // Never reflect identity or arbitrary metadata in the preview; retain only
  // explicitly validated, bounded metadata needed for dispatch.
  return { view: { index, valid: true, provider, providerSource, label: `Imported account ${index + 1}`, mode: refresh ? "access+refresh" : "access", expiresAt, refreshable: false }, access, refresh: refresh ?? undefined, authType, workspaceId, kiroMetadata, promptqlProjectId };
}
export function prepareTokenImport(body: unknown): Prepared[] | null {
  if (!isObject(body) || typeof body.provider !== "string" || body.provider.length > 100 || !canonical(body.provider) || !Object.hasOwn(body, "accounts")) return null;
  const accounts = Array.isArray(body.accounts) ? body.accounts : [body.accounts];
  if (!accounts.length || accounts.length > 100) return null;
  return accounts.map((account, i) => prepare(account, body.provider as string, i));
}
export async function saveTokenImport(items: Prepared[], _legacyAudit?: (id: string, provider: string) => void) {
  const results: Record<string, unknown>[] = [];
  for (const item of items) {
    if (!item.view.valid || !item.access || !item.authType) { results.push(item.view); continue; }
    try {
      const conn = await persistTokenImport(getDbInstance(), {
        provider: String(item.view.provider), authType: item.authType as "oauth" | "apikey",
        access: item.access, refresh: item.refresh, name: `${item.view.label} ${randomUUID().slice(0, 8)}`,
        expiresAt: typeof item.view.expiresAt === "string" ? item.view.expiresAt : null, workspaceId: item.workspaceId, kiroMetadata: item.kiroMetadata, promptqlProjectId: item.promptqlProjectId,
      });
      if (conn.created) backupDbFile("pre-write");
      results.push({ ...item.view, id: conn.id });
    } catch (error) { results.push({ index: item.view.index, valid: false, error: error instanceof ImportCredentialConflict ? "Import conflicts with existing credentials; existing account was not changed" : "Could not securely save account; check encryption configuration" }); }
  }
  return results;
}
