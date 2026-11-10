import {
  DEFAULT_ANTIGRAVITY_CLIENT_PROFILE,
  normalizeAntigravityClientProfile,
  type AntigravityClientProfile,
} from "@/shared/constants/antigravityClientProfile";
import { getAntigravityContentHeaders, ANTIGRAVITY_HUB_VERSION } from "./antigravityHeaders.ts";
import { getAntigravityVersionPin } from "@/lib/db/antigravityVersionPin";
import type { AntigravityCredentialsLike } from "./antigravityIdentity.ts";
import {
  resolveAntigravityCliVersion,
} from "./antigravityVersion.ts";

export {
  ANTIGRAVITY_CLIENT_PROFILE_VALUES,
  DEFAULT_ANTIGRAVITY_CLIENT_PROFILE,
  normalizeAntigravityClientProfile,
  type AntigravityClientProfile,
} from "@/shared/constants/antigravityClientProfile";

const resolvedProfile = Symbol("antigravityClientProfile");

export function withResolvedAntigravityClientProfile<T extends AntigravityProfileCredentials>(credentials: T): T {
  return { ...credentials, [resolvedProfile]: getAntigravityClientProfile(credentials) };
}

type AntigravityProfileCredentials = AntigravityCredentialsLike & {
  providerSpecificData?: Record<string, unknown> | null;
  [resolvedProfile]?: AntigravityClientProfile;
};

const ABSENT_CONTENT_IDENTITY_HEADERS = [
  "x-client-name",
  "x-client-version",
  "x-machine-id",
  "x-vscode-sessionid",
  "X-Goog-Api-Client",
  "Client-Metadata",
] as const;

export function getAntigravityClientProfile(
  credentials?: AntigravityProfileCredentials | null
): AntigravityClientProfile {
  const frozen = credentials?.[resolvedProfile];
  if (frozen === "hub" || frozen === "cli") return frozen;
  const override = process.env.STYX_ANTIGRAVITY_CLIENT_PROFILE?.trim().toLowerCase();
  if (["hub", "ide", "cli", "harness", "sdk"].includes(override ?? "")) {
    return normalizeAntigravityClientProfile(override);
  }
  const fromProviderData =
    credentials?.providerSpecificData &&
    typeof credentials.providerSpecificData === "object" &&
    !Array.isArray(credentials.providerSpecificData)
      ? credentials.providerSpecificData.clientProfile
      : undefined;

  return normalizeAntigravityClientProfile(fromProviderData);
}

export async function resolveAntigravityClientVersion(
  profile: AntigravityClientProfile
): Promise<string> {
  if (profile === "hub") return Promise.resolve(ANTIGRAVITY_HUB_VERSION);
  const version = await resolveAntigravityCliVersion();
  return getAntigravityVersionPin(profile) ?? version;
}

export function removeHeaderCaseInsensitive(headers: Record<string, string>, name: string): void {
  const lowerName = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lowerName) {
      delete headers[key];
    }
  }
}

function getProjectHeaderValue(body: unknown): string | null {
  const project =
    body && typeof body === "object" ? (body as Record<string, unknown>).project : null;
  if (typeof project !== "string" || project.trim().length === 0) return null;
  if (project === "test-project" || project === "project-id" || project === "aicode-consumers") return null;
  return project;
}

/** Apply the selected official client identity to a Cloud Code content request. */
export function applyAntigravityClientProfileHeaders(
  headers: Record<string, string>,
  credentials: AntigravityProfileCredentials | null | undefined,
  body: unknown
): AntigravityClientProfile {
  const profile = getAntigravityClientProfile(credentials);
  const identityHeaders = getAntigravityContentHeaders(profile);

  removeHeaderCaseInsensitive(headers, "User-Agent");
  headers["User-Agent"] = identityHeaders["User-Agent"];
  for (const name of ABSENT_CONTENT_IDENTITY_HEADERS) {
    removeHeaderCaseInsensitive(headers, name);
  }

  const project = getProjectHeaderValue(body);
  removeHeaderCaseInsensitive(headers, "x-goog-user-project");
  if (project && profile !== "hub") {
    headers["x-goog-user-project"] = project;
  }

  return profile;
}
