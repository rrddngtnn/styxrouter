/** Independently packaged TOON codec. Encoding failures fail open. */
import { encode as toonEncode, decode as toonDecode } from "@toon-format/toon";

export const TOON_FENCE_OPEN = "```toon";
export const TOON_FENCE_CLOSE = "```";

export function encodeToonBlock(arr: Record<string, unknown>[]): string | null {
  try {
    return toonEncode(arr);
  } catch {
    return null;
  }
}

export function wrapToon(blockContent: string): string {
  return `${TOON_FENCE_OPEN}\n${blockContent}\n${TOON_FENCE_CLOSE}`;
}

export function decodeToon(text: string): Record<string, unknown>[] {
  let inner = text;
  if (inner.startsWith(TOON_FENCE_OPEN + "\n")) {
    inner = inner.slice(TOON_FENCE_OPEN.length + 1);
    if (inner.endsWith("\n" + TOON_FENCE_CLOSE)) {
      inner = inner.slice(0, inner.length - TOON_FENCE_CLOSE.length - 1);
    } else if (inner.endsWith(TOON_FENCE_CLOSE)) {
      inner = inner.slice(0, inner.length - TOON_FENCE_CLOSE.length);
    }
  }
  try {
    const decoded = toonDecode(inner);
    if (Array.isArray(decoded)) return decoded as Record<string, unknown>[];
    return [decoded as Record<string, unknown>];
  } catch {
    return [];
  }
}
