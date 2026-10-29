// Reviewed static routes: prefixes are positional, not a vocabulary of safe words.
// Dynamic resource identifiers are never retained, including in suffix templates.
const STATIC_PREFIXES = [
  "/v1/chat/completions", "/v1/messages/count_tokens", "/v1/messages",
  "/v1/embeddings", "/v1/responses", "/v1/models", "/v1/files",
  "/v1/audio/transcriptions", "/v1/audio/translations", "/v1/audio/speech",
  "/v1/images/generations", "/v1/moderations", "/v1/completions", "/v1",
];
const REDACTED = "[REDACTED]";

function redactPath(path: string): string {
  if (!path || path === "/") return path;
  const parts = path.split("/");
  // Do not normalize dot segments or encoded separators before classifying.
  const ambiguous = /\\|[\x00-\x20]|(?:^|\/)\.{1,2}(?:\/|$)|%(?:2e|25)/i.test(path);
  const prefix = ambiguous ? undefined : STATIC_PREFIXES.find((p) => path === p || path.startsWith(`${p}/`));
  const prefixLength = prefix ? prefix.split("/").length - 1 : 0;
  const suffixContent = !ambiguous && parts.length === 5 && parts[1] === "v1" && parts[2] === "files" && parts[4] === "content";
  return parts.map((part, i) => {
    if (!part) return "";
    if (i <= prefixLength || (suffixContent && i === 4)) return part;
    return REDACTED;
  }).join("/");
}

function redactPaths(input: string): string {
  // Process absolute URLs in free text without parsing/normalizing the path.
  const absolute = input.replace(/https?:\/\/[^\s/\\"'<>?#]+(?:[\/\\][^\s"'<>?#]*)?/gi, (url) => {
    const start = url.indexOf("://") + 3;
    const offset = url.slice(start).search(/[\/\\]/);
    const authorityEnd = offset < 0 ? -1 : start + offset;
    if (authorityEnd < 0) return url;
    return url.slice(0, authorityEnd) + redactPath(url[authorityEnd] === "\\" ? `/${url.slice(authorityEnd + 1)}` : url.slice(authorityEnd));
  });
  if (absolute.startsWith("/")) {
    const end = absolute.search(/[?#]/);
    return redactPath(end < 0 ? absolute : absolute.slice(0, end)) + (end < 0 ? "" : absolute.slice(end));
  }
  return absolute;
}

// Redact credentials in URL-shaped log fields without changing harmless query parameters.
export function redactLogUrl<T>(value: T): T {
  if (typeof value !== "string") return value;
  const redact = (input: string, depth: number): string => redactPaths(input
    .replace(/(https?:\/\/)[^\s/@]+@/gi, "$1[REDACTED]@")
    .replace(/([?&#])([^=&#\s]+)=([^&#\s]*)/g, (match, separator: string, key: string, raw: string) => {
      let decodedKey = key;
      for (let i = 0; i < 8; i++) {
        let next: string;
        try { next = decodeURIComponent(decodedKey); } catch { break; }
        if (next === decodedKey) break;
        decodedKey = next;
      }
      if (/^(?:key|password|secret|code|signature|x-amz-signature)$/i.test(decodedKey) || isSensitiveLogKey(decodedKey)) {
        return `${separator}${key}=[REDACTED]`;
      }
      // Encoded nested URLs can carry credentials for an entirely different site.
      // Redact the enclosing value rather than risk leaking another encoding layer.
      let decoded = raw;
      for (let i = 0; i < 8; i++) {
        let next: string;
        try { next = decodeURIComponent(decoded); } catch { break; }
        if (next === decoded) break;
        decoded = next;
      }
      if (depth < 8 && redact(decoded, depth + 1) !== decoded) {
        return `${separator}${key}=[REDACTED]`;
      }
      return match;
    }));
  return redact(value, 0) as T;
}

export function isSensitiveLogKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[-_]/g, "");
  return normalized.includes("authorization") || normalized.includes("cookie") ||
    normalized.includes("apikey") || normalized.endsWith("token") ||
    normalized.includes("runtimekey") || normalized.includes("storagestate") ||
    normalized === "password" || normalized.endsWith("secret") || normalized === "xstyxleaseowner";
}
