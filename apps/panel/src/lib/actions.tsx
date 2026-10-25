import { useState, type ReactNode } from "react";
import { Dialog } from "@radix-ui/themes";
import { toast } from "sonner";
import { Copy, Check, KeyRound, X } from "lucide-react";
import { ApiError } from "./api.ts";

/** Runs an async action, tracks busy/error, fires a Sonner toast, and refreshes the list afterwards. */
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
      const msg = e instanceof ApiError || e instanceof Error ? e.message : String(e);
      setError(msg);
      toast.error(msg);
      return undefined;
    } finally {
      setBusy(null);
    }
  }
  return { busy, error, run, clearError: () => setError(null) };
}

/**
 * Reusable Linear/Radix Modal Dialog.
 */
export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  maxWidth = "520px",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  maxWidth?: string;
}): ReactNode {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content className="styx-modal" style={{ maxWidth }}>
        <div className="styx-modal-head">
          <div>
            <Dialog.Title className="styx-modal-title">{title}</Dialog.Title>
            {description ? (
              <Dialog.Description className="styx-modal-desc">{description}</Dialog.Description>
            ) : null}
          </div>
          <Dialog.Close>
            <button type="button" className="styx-icon-btn" aria-label="Close modal">
              <X size={16} />
            </button>
          </Dialog.Close>
        </div>
        <div className="styx-modal-body">{children}</div>
      </Dialog.Content>
    </Dialog.Root>
  );
}

/** A secret the server shows exactly once (new or regenerated API key), rendered inside a clean modal/banner. */
export function SecretBanner({ title, secret, onDismiss }: { title: string; secret: string; onDismiss: () => void }): ReactNode {
  const [copied, setCopied] = useState(false);

  function copy() {
    navigator.clipboard?.writeText(secret).then(
      () => {
        setCopied(true);
        toast.success("API key copied to clipboard");
      },
      () => setCopied(false),
    );
  }

  return (
    <div className="secret-banner" role="status">
      <div className="secret-banner-head">
        <KeyRound size={16} />
        <strong>{title}</strong>
      </div>
      <p className="muted">Copy this key now. For security, only its prefix is stored in plaintext and it cannot be shown again.</p>
      <code className="secret-value">{secret}</code>
      <div className="row-actions">
        <button type="button" className="btn-add" onClick={copy}>
          {copied ? <><Check size={14} /> Copied</> : <><Copy size={14} /> Copy key</>}
        </button>
        <button type="button" className="btn-ghost" onClick={onDismiss}>
          I have saved it
        </button>
      </div>
    </div>
  );
}
