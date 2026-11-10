export const ANTIGRAVITY_CLIENT_PROFILE_VALUES = ["hub", "cli"] as const;

export type AntigravityClientProfile = (typeof ANTIGRAVITY_CLIENT_PROFILE_VALUES)[number];

export const DEFAULT_ANTIGRAVITY_CLIENT_PROFILE: AntigravityClientProfile = "hub";

export type AntigravityClientProfileSetting = AntigravityClientProfile;

export const ANTIGRAVITY_CLIENT_PROFILE_OPTIONS: Array<{
  value: AntigravityClientProfileSetting;
  labelKey: "antigravityClientProfileHub" | "antigravityClientProfileCli";
}> = [
  { value: "hub", labelKey: "antigravityClientProfileHub" },
  { value: "cli", labelKey: "antigravityClientProfileCli" },
];

export function normalizeAntigravityClientProfile(value: unknown): AntigravityClientProfile {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "cli" || normalized === "hub") {
      return normalized;
    }
    // Legacy IDE execution was retired; old saved values transparently use Hub.
    if (normalized === "ide") return "hub";
    // Read-only compatibility for values persisted before the official CLI profile
    // replaced StyxRouter's synthetic harness/sdk naming. New writes are validated
    // against ANTIGRAVITY_CLIENT_PROFILE_VALUES and cannot reintroduce these aliases.
    if (normalized === "harness" || normalized === "sdk") {
      return "cli";
    }
  }
  return DEFAULT_ANTIGRAVITY_CLIENT_PROFILE;
}

export const normalizeAntigravityClientProfileSetting = normalizeAntigravityClientProfile;
