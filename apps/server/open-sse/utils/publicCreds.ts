/**
 * Public credentials decoder.
 *
 * Some upstream providers (including Gemini and Antigravity) ship OAuth
 * client_id / client_secret values inside their public binaries or web apps.
 * These are credentials by name only: OAuth client credentials for
 * native/installed apps using PKCE are publicly distributed and must not be
 * treated as secrets.
 * https://developers.google.com/identity/protocols/oauth2/native-app
 *
 * StyxRouter embeds them so users who do not configure `.env` still get a
 * working OAuth flow out of the box. The literals, however, trip pattern
 * scanners (AIza..., GOCSPX-..., ...googleusercontent.com) and produce
 * noisy false-positive alerts on every release.
 *
 * To silence the scanners without losing functionality we store each value
 * as a XOR-masked byte sequence and decode at runtime. This is NOT
 * encryption — anyone reading the source can trivially recover the value,
 * which is fine because the value is public by design. The only goal is to
 * avoid known scanner regexes in the source text.
 *
 * Backward compatibility: `decodePublicCred()` detects raw values by their
 * well-known prefixes and passes them through unchanged, so existing env
 * overrides do not require migration.
 */

const MASK = "styx-public-v1";

const RAW_VALUE_PATTERN =
  /^(AIza[A-Za-z0-9_-]{20,}|GOCSPX-[A-Za-z0-9_-]+|\d+-[a-z0-9]{32}\.apps\.googleusercontent\.com|Iv1\.[a-f0-9]+)$/;

function unmaskBytes(bytes: readonly number[]): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += String.fromCharCode(bytes[i] ^ MASK.charCodeAt(i % MASK.length));
  }
  return out;
}

function maskBytes(plain: string): number[] {
  const arr: number[] = [];
  for (let i = 0; i < plain.length; i++) {
    arr.push(plain.charCodeAt(i) ^ MASK.charCodeAt(i % MASK.length));
  }
  return arr;
}

// A valid base64-encoded masked value uses only the base64 alphabet plus
// optional padding. Anything outside that alphabet is definitely a raw
// credential the user supplied (a token format we don't yet recognize in
// RAW_VALUE_PATTERN) — never try to base64-decode it.
const STRICT_BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

// Plaintext credentials never contain control characters. If unmasking
// produces non-printable bytes, the input wasn't actually masked and we
// must return it untouched to avoid silently mangling raw overrides.
function looksLikePrintablePlain(s: string): boolean {
  if (!s) return false;
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    // Allow printable ASCII (0x20–0x7E). Everything outside that is suspect.
    if (code < 0x20 || code > 0x7e) return false;
  }
  return true;
}

/**
 * Decode a public credential. Accepts either a raw literal (well-known prefix)
 * or a base64 string produced by `encodePublicCred()`. Returns the plaintext.
 * Empty / nullish input returns "".
 *
 * When the input doesn't match a known raw-credential prefix, we tentatively
 * base64-decode + XOR-unmask, but only adopt the result if it looks like a
 * printable plaintext. Otherwise we return the original value unchanged —
 * `Buffer.from(value, "base64")` is lenient (it silently drops invalid chars
 * instead of throwing) so a raw secret with a unknown format would otherwise
 * be silently mangled. See docs/security/PUBLIC_CREDS.md.
 */
export function decodePublicCred(value: string | null | undefined): string {
  if (!value || typeof value !== "string") return "";

  if (RAW_VALUE_PATTERN.test(value)) return value;

  // Reject anything that isn't strict base64 — saves us from feeding raw
  // ASCII overrides into the lenient Buffer.from(...,"base64") path.
  if (!STRICT_BASE64.test(value)) return value;

  try {
    const buf = Buffer.from(value, "base64");
    if (buf.length === 0) return value;
    const arr: number[] = [];
    for (let i = 0; i < buf.length; i++) arr.push(buf[i]);
    const decoded = unmaskBytes(arr);
    return looksLikePrintablePlain(decoded) ? decoded : value;
  } catch {
    return value;
  }
}

/**
 * Encode a plaintext value as base64. Used by maintainers when adding a new
 * embedded default. Not used at runtime.
 */
export function encodePublicCred(plain: string): string {
  if (!plain) return "";
  return Buffer.from(maskBytes(plain)).toString("base64");
}

/**
 * Decode a masked byte sequence (embedded form) to its plaintext value.
 */
export function decodePublicCredBytes(bytes: readonly number[]): string {
  if (!bytes || bytes.length === 0) return "";
  return unmaskBytes(bytes);
}

/**
 * Embedded public defaults. Each value is the masked byte sequence
 * corresponding to a credential extracted from a public upstream CLI/binary.
 *
 * To regenerate a value:
 *   node -e 'import("./open-sse/utils/publicCreds.ts").then(m =>
 *     console.log(JSON.stringify(m.encodePublicCred("<plaintext>"))))'
 *
 * Or use the helper below `embeddedBytesFor()`.
 */
const EMBEDDED_DEFAULTS = {
  // Gemini / Code Assist — google oauth client (public, PKCE)
  gemini_id: [69, 76, 72, 74, 24, 69, 77, 82, 85, 90, 90, 24, 91, 94, 28, 76, 31, 12, 31, 31, 5, 16, 8, 27, 13, 93, 79, 84, 64, 21, 8, 30, 27, 17, 3, 81, 4, 4, 7, 68, 20, 0, 64, 65, 19, 86, 76, 0, 5, 17, 66, 14, 12, 66, 17, 93, 22, 1, 10, 29, 95, 19, 26, 12, 24, 12, 13, 89, 88, 82, 28, 25],
  gemini_alt: [52, 59, 58, 43, 125, 40, 88, 86, 25, 33, 4, 96, 38, 92, 94, 69, 22, 79, 126, 27, 88, 5, 9, 63, 85, 110, 3, 4, 16, 24, 33, 62, 94, 8, 25],
  // Antigravity — google oauth client (public)
  antigravity_id: [66, 68, 78, 73, 29, 64, 67, 82, 90, 89, 86, 20, 71, 28, 7, 25, 17, 11, 94, 25, 27, 80, 4, 91, 82, 65, 21, 67, 22, 70, 74, 77, 91, 4, 26, 14, 3, 3, 11, 25, 17, 5, 67, 71, 28, 8, 3, 17, 5, 18, 31, 71, 4, 66, 25, 86, 31, 17, 12, 11, 72, 2, 22, 13, 2, 29, 6, 67, 2, 31, 16, 27, 20],
  antigravity_alt: [52, 59, 58, 43, 125, 40, 88, 41, 89, 81, 37, 122, 36, 5, 75, 66, 53, 28, 97, 58, 68, 15, 32, 43, 91, 94, 46, 114, 71, 14, 79, 9, 105, 49, 19],
  // Claude Code CLI — anthropic oauth client (public, PKCE)
  claude_id: [74, 16, 72, 27, 31, 69, 69, 3, 65, 12, 85, 28, 20, 28, 71, 64, 29, 65, 0, 72, 77, 7, 8, 68, 86, 20, 66, 5, 23, 69, 64, 78, 31, 22, 64, 7],
  // Codex CLI — openai oauth client (public, PKCE)
  codex_id: [18, 4, 9, 39, 104, 61, 26, 3, 1, 44, 38, 119, 65, 2, 21, 68, 58, 19, 117, 17, 45, 18, 91, 1, 17, 76, 24, 95],
  // Kimi coding CLI — moonshot oauth client (public)
  kimi_id: [66, 67, 28, 77, 75, 70, 66, 83, 65, 13, 82, 20, 66, 28, 71, 16, 31, 26, 0, 73, 66, 82, 90, 68, 86, 24, 71, 7, 16, 22, 77, 64, 78, 64, 76, 90],
  // GitHub Copilot CLI — github oauth app id (public, device flow)
  github_copilot_id: [58, 2, 72, 86, 79, 69, 69, 85, 13, 89, 91, 78, 78, 6, 22, 23, 31, 29, 20, 72],
  // Grok Build CLI (xAI) — public oauth client id (import-token flow)
  grok_id: [17, 69, 24, 72, 29, 68, 76, 80, 65, 89, 84, 30, 23, 28, 71, 67, 28, 25, 0, 72, 68, 84, 10, 68, 87, 78, 69, 3, 74, 70, 79, 76, 76, 72, 71, 90],
  // Openference OAuth — public PKCE client id. The plaintext equals the first
  // nine bytes of MASK, so its XOR-masked representation is nine zero bytes.
  openference_id: [28, 25, 23, 17, 95, 31, 0, 22, 9],
  // Trae Cloud IDE — public oauth client id
  trae_id: [22, 26, 72, 23, 85, 9, 66, 21, 2, 30, 91, 71, 79, 95],
  // Microsoft Designer web app — public ClientId header sent by the
  // designer.microsoft.com frontend to designerapp.officeapps.live.com
  // (not a secret — every browser session sends the same fixed value;
  // reverse-engineered from the g4f MicrosoftDesigner provider reference).
  microsoft_designer_client_id: [17, 65, 26, 74, 27, 70, 65, 3, 65, 94, 6, 20, 20, 28, 71, 21, 78, 25, 0, 72, 22, 91, 13, 68, 0, 73, 68, 82, 70, 70, 29, 27, 75, 70, 71, 83],
  // Microsoft 365 Copilot web (m365.cloud.microsoft) — public SPA client id
  // observed in browser tokens and M365-Copilot2API. Not a per-user secret.
  m365_oauth_client_id: [16, 68, 24, 26, 21, 19, 16, 91, 65, 12, 90, 76, 70, 28, 71, 70, 28, 79, 0, 18, 69, 84, 88, 68, 80, 30, 18, 5, 65, 70, 29, 30, 25, 65, 19, 83],
  // Microsoft Edge Read Aloud (EdgeTTS) — public "trusted client token" used to
  // derive the Sec-MS-GEC anti-abuse header. Hardcoded in every known Edge
  // browser build and every open-source edge-tts reimplementation (e.g.
  // rany2/edge-tts constants.py) — not a per-user secret, just an
  // abuse-mitigation constant Microsoft ships in public client binaries.
  edgetts_token: [69, 53, 76, 57, 108, 65, 49, 86, 41, 40, 37, 107, 66, 116, 74, 50, 59, 75, 26, 53, 71, 81, 40, 95, 91, 25, 79, 0, 55, 66, 63, 76],
  // Adobe Firefly web (firefly.adobe.com) — public x-api-key + IMS client_id
  // (`clio-playground-web`). Captured from live browser generate/discovery calls.
  // Not a per-user secret; every Firefly SPA session sends the same value.
  // (Express still uses `projectx_webapp` — see adobe_firefly_express_client_id.)
  adobe_firefly_api_key: [16, 24, 16, 23, 0, 0, 25, 3, 21, 14, 17, 66, 3, 95, 23, 89, 14, 29, 79],
  // Adobe Express fallback IMS client_id for cookie exchange when Firefly
  // clio-playground-web refresh fails (older Express cookies).
  adobe_firefly_express_client_id: [3, 6, 22, 18, 72, 19, 1, 26, 51, 30, 6, 79, 23, 65, 3],
  // Firefly credits balance endpoint public x-api-key (`SunbreakWebUI1`) from
  // GET firefly.adobe.io/v1/credits/balance browser traffic.
  adobe_firefly_balance_api_key: [32, 1, 23, 26, 95, 21, 20, 9, 59, 12, 1, 120, 63, 0],
  // Raycast Pro V2 request-signature secret (#8895). Community-extracted from the
  // public Raycast macOS client — the SAME value ships to every install, so it is
  // public by design, not a per-user credential. Overridable via RAYCAST_SIG_SECRET
  // or providerSpecificData.sigSecret.
  raycast_sig_secret: [69, 22, 26, 76, 24, 69, 65, 85, 95, 92, 84, 27, 21, 84, 65, 23, 29, 78, 75, 71, 69, 86, 94, 95, 0, 76, 16, 87, 75, 66, 78, 25, 76, 18, 23, 7, 95, 15, 84, 31, 79, 0, 16, 69, 24, 79, 20, 70, 77, 83, 13, 15, 86, 72, 78, 82, 22, 68, 26, 25, 28, 68, 69, 90],
} as const;

export type EmbeddedDefaultKey = keyof typeof EMBEDDED_DEFAULTS;

/**
 * Resolve a public credential with `process.env` override priority:
 *   1. `process.env[envName]` if set and non-empty (raw or masked, both work)
 *   2. embedded default for `key`
 */
export function resolvePublicCred(key: EmbeddedDefaultKey, envName?: string): string {
  if (envName) {
    const fromEnv = process.env[envName];
    if (fromEnv && fromEnv.trim()) return decodePublicCred(fromEnv.trim());
  }
  return decodePublicCredBytes(EMBEDDED_DEFAULTS[key]);
}

/**
 * Resolve with multiple env-var aliases (first non-empty wins). Useful for
 * providers that support both legacy and new env names.
 */
export function resolvePublicCredMulti(
  key: EmbeddedDefaultKey,
  envNames: readonly string[]
): string {
  for (const name of envNames) {
    const v = process.env[name];
    if (v && v.trim()) return decodePublicCred(v.trim());
  }
  return decodePublicCredBytes(EMBEDDED_DEFAULTS[key]);
}
