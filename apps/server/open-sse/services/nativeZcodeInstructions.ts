import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";
import { isAbsolute } from "node:path";

const MAX_INSTRUCTION_BYTES = 256 * 1024;
export type NativeInstructionStatus = "disabled" | "loaded" | "unavailable";

/** Operator environment only: never resolve a path supplied by a request or DB setting. */
export function loadNativeZcodeInstructions(path: unknown = process.env.RATMAN_SOUL_PATH): {
  text: string; status: NativeInstructionStatus;
} {
  if (path === undefined || path === "") return { text: "", status: "disabled" };
  if (typeof path !== "string" || !isAbsolute(path) || path.includes("\0")) {
    return { text: "", status: "unavailable" };
  }
  let fd: number | undefined;
  try {
    // Nonblocking avoids hanging on FIFOs; fstat and bounded reads use the same fd.
    fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK);
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_INSTRUCTION_BYTES) {
      return { text: "", status: "unavailable" };
    }
    const bytes = Buffer.alloc(MAX_INSTRUCTION_BYTES + 1);
    let length = 0;
    while (length < bytes.length) {
      const count = readSync(fd, bytes, length, bytes.length - length, null);
      if (!count) break;
      length += count;
    }
    if (length > MAX_INSTRUCTION_BYTES) return { text: "", status: "unavailable" };
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, length)).trim();
    if (!text || text.includes("\0")) return { text: "", status: "unavailable" };
    return { text, status: "loaded" };
  } catch {
    return { text: "", status: "unavailable" };
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

export interface NativeZcodePrompt {
  conversation: string;
  instructions?: string;
}

/** Keep injected instructions separate from caller text, not a textual dedupe marker.
 * Reapplying replaces only our own slot; even an identical caller prefix survives.
 * Cloning also preserves typed fixture/history/cache-control objects supplied by callers.
 */
export function applyNativeZcodeInstructions<T extends NativeZcodePrompt>(input: T, instructions: string): T {
  return { ...structuredClone(input), instructions: instructions || undefined };
}

/** sendPrompt supports one text content field, not an upstream system channel. */
export function renderNativeZcodePrompt(input: NativeZcodePrompt): string {
  return input.instructions
    ? `[Instructions]\n${input.instructions}\n\n${input.conversation}`
    : input.conversation;
}
