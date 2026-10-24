import { useState, type ReactNode } from "react";
import { ApiError } from "./api.ts";

/** Runs an async action, tracks busy/error, and refreshes the list afterwards. */
export function useAction(onDone?: () => void) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function run<T>(label: string, fn: () => Promise<T>, confirmText?: string): Promise<T | undefined> {
    if (confirmText && !window.confirm(confirmText)) return undefined;
    setBusy(label);
    setError(null);
    try {
      const out = await fn();
      onDone?.();
      return out;
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : String(e));
      return undefined;
    } finally {
      setBusy(null);
    }
  }
  return { busy, error, run, clearError: () => setError(null) };
}

/** A secret the server shows exactly once (new or regenerated API key). */
export function SecretBanner({ title, secret, onDismiss }: { title: string; secret: string; onDismiss: () => void }): ReactNode {
  const [copied, setCopied] = useState(false);
  return (
    <div className="secret-banner" role="status">
      <strong>{title}</strong>
      <p className="muted">Copy it now. It is shown only once and cannot be retrieved later.</p>
      <code className="secret-value">{secret}</code>
      <div className="row-actions">
        <button
          type="button"
          className="btn-add"
          onClick={() => navigator.clipboard?.writeText(secret).then(() => setCopied(true), () => setCopied(false))}
        >
          {copied ? "Copied ✓" : "Copy"}
        </button>
        <button type="button" className="btn-ghost" onClick={onDismiss}>
          I have saved it
        </button>
      </div>
    </div>
  );
}
