/** Candidate replacement from logging safety contracts; see release-readiness-audit.md.
 * Not a translation or a clean-room claim. Uninspectable values fail closed.
 */
const HIDDEN = "[REDACTED]";
const credentialField = /^(?:authorization|proxy-authorization|password|passwd|secret|token|access[_-]?token|refresh[_-]?token|api[_-]?key|x-api-key|cookie|set-cookie)$/i;

export function redactSecrets(text: string): string {
  return text
    .replace(/\b(?:authorization\s*[:=]\s*)?bearer\s+[^\s"',;<>]+/gi, `Bearer ${HIDDEN}`)
    .replace(/\b(?:x-api-key|api[_-]?key)\s*[:=]\s*[^\s"',;<>]+/gi, `api_key=${HIDDEN}`)
    .replace(/api\.telegram\.org\/bot[0-9]+:[A-Za-z0-9_-]+/gi, `api.telegram.org/bot${HIDDEN}`)
    .replace(/\bsk-[A-Za-z0-9_-]{16,}/g, `sk-${HIDDEN}`);
}

export function redactLogArgs(args: unknown[]): unknown[] {
  let remaining = 2000;
  const ancestors = new WeakSet<object>();
  function visit(value: unknown, depth: number): unknown {
    if (--remaining < 0 || depth > 6) return HIDDEN;
    if (typeof value === "string") return redactSecrets(value);
    if (typeof value === "function") return HIDDEN;
    if (value === null || typeof value !== "object") return value;
    if (ancestors.has(value)) return HIDDEN;
    ancestors.add(value);
    try {
      if (!Array.isArray(value) && !(value instanceof Error) && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return HIDDEN;
      if (value instanceof Error) {
        const descriptors = Object.getOwnPropertyDescriptors(value);
        const message = descriptors.message?.value;
        const stack = descriptors.stack?.value;
        const safeMessage = typeof message === "string" ? redactSecrets(message) : HIDDEN;
        const safeStack = typeof stack === "string" ? redactSecrets(stack) : undefined;
        const copy = new Error(safeMessage);
        copy.stack = safeStack;
        // Never return a subclass instance: inherited toJSON/name accessors can
        // execute later inside the logger after this hook has finished.
        let changed = Object.getPrototypeOf(value) !== Error.prototype || safeMessage !== message || safeStack !== stack;
        for (const [key, descriptor] of Object.entries(descriptors)) {
          if (key === "message" || key === "stack") continue;
          const safe = credentialField.test(key) || !("value" in descriptor) ? HIDDEN : visit(descriptor.value, depth + 1);
          if (safe !== descriptor.value) changed = true;
          Object.defineProperty(copy, key, { value: safe, enumerable: descriptor.enumerable, configurable: true, writable: true });
        }
        return changed ? copy : value;
      }
      const descriptors = Object.getOwnPropertyDescriptors(value);
      const copy: any = Array.isArray(value) ? [] : {};
      let changed = false;
      for (const [key, descriptor] of Object.entries(descriptors)) {
        if (Array.isArray(value) && key === "length") continue;
        const safe = credentialField.test(key) || !("value" in descriptor) ? HIDDEN : visit(descriptor.value, depth + 1);
        changed ||= safe !== descriptor.value;
        Object.defineProperty(copy, key, { value: safe, enumerable: true, configurable: true, writable: true });
        if (remaining < 0) { changed = true; break; }
      }
      return changed ? copy : value;
    } catch {
      return HIDDEN;
    } finally {
      ancestors.delete(value);
    }
  }
  const result = args.map((arg) => visit(arg, 0));
  return result.some((arg, index) => arg !== args[index]) ? result : args;
}
