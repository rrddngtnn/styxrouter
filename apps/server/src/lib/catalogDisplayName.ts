/**
 * Unified semantic display-name normalizer for `/v1/models` (both compact and expanded).
 *
 * Guarantees every catalog entry has a clean, consistent human-readable `name`:
 * - Never `undefined`, empty, or an unformatted raw slug.
 * - Uniform base vs fixed-effort variant formatting:
 *     - Base model: `<Base Name>`
 *     - Fixed-effort variant (expanded): `<Base Name> (<Tier>)`
 *       with canonical tier labels: `None`, `Low`, `Medium`, `High`, `XHigh`, `Max`, `Ultra`.
 * - Consistent brand, acronym, version, and casing normalization across all providers.
 * - Clean upstream label strategy: strips redundant leading provider prefixes (when not part of
 *   the model ID itself), billing/credit multipliers (e.g. `(1.3x credit)`), and redundant
 *   capability badges (e.g. `(Vision)`, or `(Thinking)` when the model ID is not `-thinking`),
 *   leaving provider disambiguation to `disambiguateCatalogModelNames()`.
 *
 * Pure module: no DB, no IO, no private provider codenames.
 */

const CANONICAL_EFFORT_LABELS: Readonly<Record<string, string>> = {
  none: "None",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "XHigh",
  max: "Max",
  ultra: "Ultra",
};

const KNOWN_BRAND_TOKENS: Readonly<Record<string, string>> = {
  ai: "AI",
  agy: "AGY",
  api: "API",
  audio: "Audio",
  auto: "Auto",
  chat: "Chat",
  chatgpt: "ChatGPT",
  claude: "Claude",
  code: "Code",
  coder: "Coder",
  codex: "Codex",
  deepseek: "DeepSeek",
  embed: "Embed",
  embedding: "Embedding",
  flash: "Flash",
  flashx: "FlashX",
  gemini: "Gemini",
  glm: "GLM",
  gpt: "GPT",
  grok: "Grok",
  haiku: "Haiku",
  hd: "HD",
  high: "High",
  hy: "HY",
  image: "Image",
  kimi: "Kimi",
  lite: "Lite",
  llama: "Llama",
  low: "Low",
  max: "Max",
  medium: "Medium",
  mimo: "MiMo",
  mini: "Mini",
  minimax: "MiniMax",
  mistral: "Mistral",
  nano: "Nano",
  next: "Next",
  none: "None",
  ocr: "OCR",
  openai: "OpenAI",
  opus: "Opus",
  oss: "OSS",
  preview: "Preview",
  pro: "Pro",
  qwen: "Qwen",
  rerank: "Rerank",
  reserve: "Reserve",
  review: "Review",
  sonar: "Sonar",
  sonnet: "Sonnet",
  spark: "Spark",
  thinking: "Thinking",
  tiered: "Tiered",
  tts: "TTS",
  turbo: "Turbo",
  ultra: "Ultra",
  video: "Video",
  vision: "Vision",
  vl: "VL",
  volc: "Volc",
  xhigh: "XHigh",
  xl: "XL",
};

const PROVIDER_PREFIX_LABELS: Readonly<Record<string, readonly string[]>> = {
  kiro: ["kiro"],
  antigravity: ["antigravity", "agy"],
  agy: ["antigravity", "agy"],
  codex: ["codex"],
  glm: ["glm", "z.ai", "zai"],
  "codebuddy-cn": ["codebuddy", "codebuddy cn", "codebuddy-cn"],
  "opencode-go": ["opencode", "opencode go", "opencode-go"],
  "opencode-zen": ["opencode", "opencode zen", "opencode-zen"],
  opencode: ["opencode"],
};

const TRAILING_EFFORT_PAREN_RE =
  /\s*\((?:none|low|medium|high|xhigh|max|ultra|no\s+thinking)\)\s*$/i;

const BILLING_BADGE_RE = /\s*\(\s*\d+(?:\.\d+)?x\s+credits?\s*\)/gi;

export function formatCanonicalEffortLabel(effort: string): string {
  const key = effort.trim().toLowerCase();
  if (Object.hasOwn(CANONICAL_EFFORT_LABELS, key)) {
    return CANONICAL_EFFORT_LABELS[key];
  }
  return key ? key.charAt(0).toUpperCase() + key.slice(1) : "";
}

/**
 * Strip a trailing parenthesized effort label such as `(Low)`, `(xHigh)`, or `(no thinking)`.
 */
export function stripTrailingEffortLabel(name: string): string {
  let result = name.trim();
  while (TRAILING_EFFORT_PAREN_RE.test(result)) {
    result = result.replace(TRAILING_EFFORT_PAREN_RE, "").trim();
  }
  return result;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripSpecificTrailingEffort(name: string, effort: string): string {
  let result = stripTrailingEffortLabel(name);
  const lowered = effort.trim().toLowerCase();
  if (!lowered) return result;
  const escaped = escapeRegExp(lowered);
  // Strip bare trailing effort word or hyphenated suffix matching the alias's locked effort,
  // e.g. "GLM 5.3 High" -> "GLM 5.3", "claude-opus-5.5-low" -> "claude-opus-5.5".
  result = result.replace(new RegExp(`(?:\\s+|-)${escaped}$`, "i"), "").trim();
  return stripTrailingEffortLabel(result);
}

function stripRedundantProviderPrefix(
  value: string,
  provider: string | null | undefined,
  modelId: string
): string {
  if (!provider) return value;
  const normalizedProvider = provider.trim().toLowerCase();
  const candidates = PROVIDER_PREFIX_LABELS[normalizedProvider];
  if (!candidates) return value;

  const bareModelId = modelId.includes("/") ? modelId.split("/").pop() || modelId : modelId;
  const loweredModelId = bareModelId.toLowerCase();

  for (const prefix of candidates) {
    const prefixToken = prefix.replace(/[\s.-]+/g, "");
    // Keep the prefix if the model ID itself begins with it (e.g. `codex-auto-review`, `glm-5.3`).
    if (
      loweredModelId === prefix ||
      loweredModelId.startsWith(`${prefix}-`) ||
      loweredModelId.startsWith(`${prefix}_`) ||
      loweredModelId.startsWith(`${prefixToken}-`) ||
      loweredModelId.startsWith(`${prefixToken}_`)
    ) {
      continue;
    }
    const re = new RegExp(`^${escapeRegExp(prefix)}(?:\\s+|:\\s*|\\s*-\\s*)`, "i");
    if (re.test(value)) {
      const stripped = value.replace(re, "").trim();
      if (stripped.length > 0) return stripped;
    }
  }
  return value;
}

function stripUpstreamNoise(
  value: string,
  provider: string | null | undefined,
  modelId: string
): string {
  let result = value.trim();
  // Remove billing / credit multiplier annotations (e.g. "(2.0x credit)", "(0.4x credits)").
  result = result.replace(BILLING_BADGE_RE, "");
  // Remove redundant "(Vision)" badge — vision is exposed in structured capabilities.
  result = result.replace(/\s*\(\s*vision\s*\)/gi, "");

  const loweredId = modelId.toLowerCase();
  if (!/(?:^|[-_/])thinking(?:$|[-_/])/.test(loweredId)) {
    // Strip redundant "(Thinking)" badge when the model ID itself is not a `-thinking` variant.
    result = result.replace(/\s*\(\s*thinking\s*\)/gi, "");
  } else {
    // Normalize "(Thinking)" into a plain word when `-thinking` is part of the model identity.
    result = result.replace(/\s*\(\s*thinking\s*\)/gi, " Thinking");
  }

  result = stripRedundantProviderPrefix(result, provider, modelId);
  return result.replace(/\s+/g, " ").trim();
}

function formatSingleToken(token: string): string {
  if (!token) return token;

  // Preserve parenthesized qualifiers while normalizing their inner tokens.
  if (token.startsWith("(") && token.endsWith(")") && token.length > 2) {
    const inner = formatTokenSequence(token.slice(1, -1));
    return `(${inner})`;
  }

  const lower = token.toLowerCase();
  if (Object.hasOwn(KNOWN_BRAND_TOKENS, lower)) {
    return KNOWN_BRAND_TOKENS[lower];
  }

  // Compound brand+suffix like "hy4flash" -> "HY4 Flash", "hy4" -> "HY4", "hy3" -> "HY3".
  const hyFlash = /^hy(\d+(?:\.\d+)?)([a-z]+)$/i.exec(token);
  if (hyFlash) {
    return `HY${hyFlash[1]} ${formatSingleToken(hyFlash[2])}`;
  }
  const hyVer = /^hy(\d+(?:\.\d+)?)$/i.exec(token);
  if (hyVer) {
    return `HY${hyVer[1]}`;
  }

  // Qwen version tokens like "qwen3", "qwen3.7", "qwen2.5".
  const qwenVer = /^qwen(\d+(?:\.\d+)?)$/i.exec(token);
  if (qwenVer) {
    return `Qwen${qwenVer[1]}`;
  }

  // Vision/size/version alphanumerics: "5v" -> "5V", "4.6v" -> "4.6V", "120b" -> "120B", "v3.2" -> "V3.2", "m2.7" -> "M2.7", "k3.1" -> "K3.1", "r1" -> "R1".
  const versionLetterSuffix = /^(\d+(?:\.\d+)?)([vb])$/i.exec(token);
  if (versionLetterSuffix) {
    return `${versionLetterSuffix[1]}${versionLetterSuffix[2].toUpperCase()}`;
  }
  const versionLetterPrefix = /^([vmkr])(\d+(?:\.\d+)?)$/i.exec(token);
  if (versionLetterPrefix) {
    return `${versionLetterPrefix[1].toUpperCase()}${versionLetterPrefix[2]}`;
  }
  // OpenAI o-series ("o1", "o3", "o4") stays lowercase "o".
  if (/^o\d+(?:\.\d+)?$/i.test(token)) {
    return lower;
  }

  // Pure numeric / version token (e.g. "5.5", "3.8", "4").
  if (/^\d+(?:\.\d+)*$/.test(token)) {
    return token;
  }

  // Preserve mixed-case intentional identifiers (e.g. "OpenAI", "DeepSeek", "FlashX", "MiMo")
  // if they already contain internal capitals and are not all-lowercase.
  if (/[A-Z]/.test(token) && /[a-z]/.test(token)) {
    return token;
  }

  return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
}

function formatTokenSequence(input: string): string {
  // Split slash-qualified segments cleanly when formatting raw slugs like "vendor/model-name".
  if (input.includes("/") && !/\s/.test(input)) {
    const segments = input
      .split("/")
      .map((s) => s.trim())
      .filter(Boolean);
    if (segments.length > 1) {
      return segments.map((s) => formatTokenSequence(s)).join(" / ");
    }
  }

  // Protect parenthesized segments from hyphen splitting so "(Volc)" stays intact.
  const parts: string[] = [];
  const tokenRe = /\([^)]*\)|[^\s]+/g;
  let match: RegExpExecArray | null;
  while ((match = tokenRe.exec(input)) !== null) {
    const raw = match[0];
    if (raw.startsWith("(") && raw.endsWith(")")) {
      parts.push(formatSingleToken(raw));
      continue;
    }

    // Split hyphen/underscore-delimited words, keeping internal dots (versions) intact.
    const subtokens = raw.split(/[-_]+/).filter(Boolean);
    for (const sub of subtokens) {
      parts.push(formatSingleToken(sub));
    }
  }

  return normalizeCanonicalPhrases(parts.join(" "));
}

function normalizeCanonicalPhrases(text: string): string {
  let out = text.replace(/\s+/g, " ").trim();

  // GPT-OSS (keep hyphen between GPT and OSS).
  out = out.replace(/\bGPT OSS\b/gi, "GPT-OSS");

  // GPT-<version> (e.g. "GPT 5.6 Sol" -> "GPT-5.6 Sol", "GPT 6 Astra" -> "GPT-6 Astra").
  // Keeps non-versioned names spaced ("GPT Reserve").
  out = out.replace(/\bGPT (\d+(?:\.\d+)?[A-Za-z]?)\b/g, "GPT-$1");

  // GLM-<version> (e.g. "GLM 5.3 Flash" -> "GLM-5.3 Flash", "GLM 5V Turbo" -> "GLM-5V Turbo").
  out = out.replace(/\bGLM (\d+(?:\.\d+)?[Vv]?)\b/g, "GLM-$1");

  // Claude <Family> <major> <minor> -> Claude <Family> <major>.<minor> (e.g. "Claude Sonnet 5 5" -> "Claude Sonnet 5.5").
  out = out.replace(
    /\b(Claude (?:Opus|Sonnet|Haiku)) (\d) (\d)\b/g,
    "$1 $2.$3"
  );

  // DeepSeek version normalization:
  // "DeepSeek 3.2" -> "DeepSeek V3.2", "DeepSeek V3 2" -> "DeepSeek V3.2".
  out = out.replace(/\bDeepSeek (\d+(?:\.\d+)?)\b/g, "DeepSeek V$1");
  out = out.replace(/\bDeepSeek V(\d) (\d)\b/g, "DeepSeek V$1.$2");

  // Clean up spacing before parenthesized qualifiers.
  out = out.replace(/\s+\(/g, " (").replace(/\(\s+/g, "(").replace(/\s+\)/g, ")");

  return out.trim();
}

function looksLikeRawSlug(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true;
  if (/\s/.test(trimmed)) return false;
  return trimmed === trimmed.toLowerCase() && /^[a-z0-9][a-z0-9._:/+-]*$/.test(trimmed);
}

export interface NormalizeCatalogDisplayNameOptions {
  modelId: string;
  provider?: string | null;
  /** Locked effort level when this entry is a fixed-effort alias. */
  fixedEffort?: string | null;
  /** Whether to append ` (<Tier>)` to the display name (true for fixed-effort alias rows). */
  appendEffortLabel?: boolean;
  /** Whether to strip any trailing parenthesized effort label (true for synthesized base family rows). */
  stripEffortLabel?: boolean;
  /** True for virtual combo entries (`owned_by === "combo"`). */
  isCombo?: boolean;
}

export function normalizeCatalogDisplayName(
  rawName: string | null | undefined,
  opts: NormalizeCatalogDisplayNameOptions
): string {
  const modelId = (opts.modelId || "").trim();
  const trimmedRaw = typeof rawName === "string" ? rawName.trim() : "";

  if (opts.isCombo) {
    if (trimmedRaw && !looksLikeRawSlug(trimmedRaw)) return trimmedRaw;
    const source = trimmedRaw || modelId;
    if (!source) return "Combo";
    if (/^auto$/i.test(source)) return "Auto";
    if (/^auto\//i.test(source)) {
      const suffix = source.slice("auto/".length);
      return `Auto ${formatTokenSequence(suffix)}`;
    }
    return looksLikeRawSlug(source) ? formatTokenSequence(source) : source;
  }

  let cleanModelId = modelId.replace(/^no-think\//i, "");
  if (opts.fixedEffort && opts.appendEffortLabel) {
    const escaped = escapeRegExp(opts.fixedEffort.trim().toLowerCase());
    cleanModelId = cleanModelId.replace(new RegExp(`-${escaped}$`, "i"), "");
  }

  let candidate = trimmedRaw;
  if (candidate) {
    candidate = stripUpstreamNoise(candidate, opts.provider, cleanModelId);
    if (opts.fixedEffort && opts.appendEffortLabel) {
      candidate = stripSpecificTrailingEffort(candidate, opts.fixedEffort);
    } else if (opts.stripEffortLabel) {
      const stripped = stripTrailingEffortLabel(candidate);
      if (stripped) candidate = stripped;
    }
  }

  // If the candidate is empty or still identical to a raw lowercase slug, format from cleanModelId.
  const source =
    candidate && (!looksLikeRawSlug(candidate) || !cleanModelId)
      ? candidate
      : cleanModelId || candidate || modelId;

  const normalizedBase = formatTokenSequence(source) || modelId || "Model";

  if (opts.fixedEffort && opts.appendEffortLabel) {
    const tierLabel = formatCanonicalEffortLabel(opts.fixedEffort);
    if (tierLabel) {
      return `${normalizedBase} (${tierLabel})`;
    }
  }

  return normalizedBase;
}
