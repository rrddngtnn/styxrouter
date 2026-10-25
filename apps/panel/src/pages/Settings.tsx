import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api, type JsonValue } from "../lib/api.ts";
import { useAction } from "../lib/actions.tsx";
import { useFetch } from "../lib/useFetch.ts";

type SettingsBag = Record<string, unknown>;

const FALLBACK_STRATEGIES = [
  "priority",
  "weighted",
  "fill-first",
  "round-robin",
  "p2c",
  "random",
  "least-used",
  "cost-optimized",
  "strict-random",
] as const;

export function Settings() {
  const state = useFetch<SettingsBag>("/api/settings");

  return (
    <div className="page">
      <h1>Settings</h1>
      {state.status === "ok" && <RoutingAndRuntimeSettings initial={state.data} onSaved={state.reload} />}
      <ChangePassword />
      <MigrateFromStyxRouter />
      <details style={{ marginTop: 24 }}>
        <summary className="muted" style={{ cursor: "pointer" }}>
          Raw settings JSON (read-only snapshot)
        </summary>
        {state.status === "loading" && <p>Loading…</p>}
        {state.status === "error" && <p className="bad">{state.error.message}</p>}
        {state.status === "ok" && <pre className="json">{JSON.stringify(state.data, null, 2)}</pre>}
      </details>
    </div>
  );
}

interface WildcardAlias {
  pattern: string;
  target: string;
}

function RoutingAndRuntimeSettings({ initial, onSaved }: { initial: SettingsBag; onSaved: () => void }) {
  const [fallbackStrategy, setFallbackStrategy] = useState<string>(String(initial.fallbackStrategy ?? "priority"));
  const [comboStrategy, setComboStrategy] = useState<string>(String(initial.comboStrategy ?? "fallback"));
  const [requestRetry, setRequestRetry] = useState<number>(Number(initial.requestRetry ?? 2));
  const [maxRetryIntervalSec, setMaxRetryIntervalSec] = useState<number>(Number(initial.maxRetryIntervalSec ?? 30));
  const [stickyLimit, setStickyLimit] = useState<number>(Number(initial.stickyRoundRobinLimit ?? 0));
  const [disableStickiness, setDisableStickiness] = useState<boolean>(Boolean(initial.disableSessionStickiness));
  const [promptCacheAffinity, setPromptCacheAffinity] = useState<boolean>(initial.promptCacheAffinityEnabled !== false);
  const [lkgpEnabled, setLkgpEnabled] = useState<boolean>(Boolean(initial.lkgpEnabled));
  const [autoRefreshQuota, setAutoRefreshQuota] = useState<boolean>(initial.autoRefreshProviderQuota !== false);
  const [hideHealthLogs, setHideHealthLogs] = useState<boolean>(Boolean(initial.hideHealthCheckLogs));
  const [debugMode, setDebugMode] = useState<boolean>(Boolean(initial.debugMode));
  const [aliasesText, setAliasesText] = useState<string>(() => {
    const arr = Array.isArray(initial.wildcardAliases) ? (initial.wildcardAliases as WildcardAlias[]) : [];
    return arr.map((a) => `${a.pattern} = ${a.target}`).join("\n");
  });
  const [savedBanner, setSavedBanner] = useState(false);
  const { busy, error, run } = useAction(() => {
    setSavedBanner(true);
    toast.success("Runtime settings saved");
    onSaved();
  });

  useEffect(() => {
    setFallbackStrategy(String(initial.fallbackStrategy ?? "priority"));
    setComboStrategy(String(initial.comboStrategy ?? "fallback"));
    setRequestRetry(Number(initial.requestRetry ?? 2));
    setMaxRetryIntervalSec(Number(initial.maxRetryIntervalSec ?? 30));
    setStickyLimit(Number(initial.stickyRoundRobinLimit ?? 0));
    setDisableStickiness(Boolean(initial.disableSessionStickiness));
    setPromptCacheAffinity(initial.promptCacheAffinityEnabled !== false);
    setLkgpEnabled(Boolean(initial.lkgpEnabled));
    setAutoRefreshQuota(initial.autoRefreshProviderQuota !== false);
    setHideHealthLogs(Boolean(initial.hideHealthCheckLogs));
    setDebugMode(Boolean(initial.debugMode));
    const arr = Array.isArray(initial.wildcardAliases) ? (initial.wildcardAliases as WildcardAlias[]) : [];
    setAliasesText(arr.map((a) => `${a.pattern} = ${a.target}`).join("\n"));
  }, [initial]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSavedBanner(false);
    const wildcardAliases: { pattern: string; target: string }[] = [];
    for (const raw of aliasesText.split("\n")) {
      const line = raw.trim();
      if (!line) continue;
      const eq = line.indexOf("=");
      if (eq <= 0) continue;
      const pattern = line.slice(0, eq).trim();
      const target = line.slice(eq + 1).trim();
      if (pattern && target) wildcardAliases.push({ pattern, target });
    }
    const payload: Record<string, JsonValue> = {
      fallbackStrategy,
      comboStrategy,
      requestRetry: Math.max(0, Math.min(10, Math.round(requestRetry))),
      maxRetryIntervalSec: Math.max(0, Math.min(300, Math.round(maxRetryIntervalSec))),
      stickyRoundRobinLimit: Math.max(0, Math.min(1000, Math.round(stickyLimit))),
      disableSessionStickiness: disableStickiness,
      promptCacheAffinityEnabled: promptCacheAffinity,
      lkgpEnabled,
      autoRefreshProviderQuota: autoRefreshQuota,
      hideHealthCheckLogs: hideHealthLogs,
      debugMode,
      wildcardAliases,
    };
    await run("save-settings", () => api.patch("/api/settings", payload));
  }

  return (
    <section className="settings-card">
      <h2>Routing & runtime</h2>
      <p className="muted">
        Account failover strategy, retry limits, prompt-cache affinity, and wildcard model aliases (persisted in SQLite).
      </p>
      <form className="stack-form" onSubmit={submit}>
        <label>
          Account fallback strategy
          <select value={fallbackStrategy} onChange={(e) => setFallbackStrategy(e.target.value)}>
            {FALLBACK_STRATEGIES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label>
          Combo expansion strategy
          <select value={comboStrategy} onChange={(e) => setComboStrategy(e.target.value)}>
            <option value="fallback">fallback (in order)</option>
            <option value="round-robin">round-robin</option>
          </select>
        </label>
        <div className="two-col" style={{ gap: 12 }}>
          <label>
            Request retries (0–10)
            <input
              type="number"
              min={0}
              max={10}
              value={requestRetry}
              onChange={(e) => setRequestRetry(Number(e.target.value))}
            />
          </label>
          <label>
            Max retry interval sec (0–300)
            <input
              type="number"
              min={0}
              max={300}
              value={maxRetryIntervalSec}
              onChange={(e) => setMaxRetryIntervalSec(Number(e.target.value))}
            />
          </label>
        </div>
        <label>
          Sticky round-robin limit (0 = off)
          <input
            type="number"
            min={0}
            max={1000}
            value={stickyLimit}
            onChange={(e) => setStickyLimit(Number(e.target.value))}
          />
        </label>
        <label className="check">
          <input type="checkbox" checked={promptCacheAffinity} onChange={(e) => setPromptCacheAffinity(e.target.checked)} />
          Keep combo targets close to provider prompt cache (promptCacheAffinityEnabled)
        </label>
        <label className="check">
          <input type="checkbox" checked={disableStickiness} onChange={(e) => setDisableStickiness(e.target.checked)} />
          Disable session stickiness globally
        </label>
        <label className="check">
          <input type="checkbox" checked={lkgpEnabled} onChange={(e) => setLkgpEnabled(e.target.checked)} />
          Enable Last Known Good Provider (LKGP) memory
        </label>
        <label className="check">
          <input type="checkbox" checked={autoRefreshQuota} onChange={(e) => setAutoRefreshQuota(e.target.checked)} />
          Auto-refresh provider quota in background
        </label>
        <label className="check">
          <input type="checkbox" checked={hideHealthLogs} onChange={(e) => setHideHealthLogs(e.target.checked)} />
          Hide health-check requests from call logs
        </label>
        <label className="check">
          <input type="checkbox" checked={debugMode} onChange={(e) => setDebugMode(e.target.checked)} />
          Debug logging mode
        </label>
        <label>
          Wildcard model aliases — one per line (<code>pattern = provider/model</code>)
          <textarea
            rows={4}
            value={aliasesText}
            onChange={(e) => setAliasesText(e.target.value)}
            placeholder={"gpt-4o* = codex/gpt-5.3-codex\nclaude-sonnet* = antigravity/claude-sonnet-4-6"}
          />
        </label>
        {error && <div className="bad">{error}</div>}
        {savedBanner && <div className="ok">Settings saved.</div>}
        <div>
          <button type="submit" className="btn-add" disabled={busy !== null}>
            {busy === "save-settings" ? "…" : "Save settings"}
          </button>
        </div>
      </form>
    </section>
  );
}

function ChangePassword() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [done, setDone] = useState(false);
  const { busy, error, run, clearError } = useAction();
  const mismatch = again.length > 0 && next !== again;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setDone(false);
    clearError();
    const out = await run("password", () => api.post("/api/auth/password", { currentPassword: current, newPassword: next }));
    if (out) {
      setDone(true);
      setCurrent("");
      setNext("");
      setAgain("");
      toast.success("Management password updated");
    }
  }

  return (
    <section className="settings-card">
      <h2>Management password</h2>
      <p className="muted">
        Used to sign in here. At least 12 characters. Other signed-in browsers stay signed in until their session expires.
      </p>
      <form className="stack-form" onSubmit={submit}>
        <input type="password" autoComplete="current-password" placeholder="Current password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
        <input type="password" autoComplete="new-password" placeholder="New password (12+ characters)" minLength={12} value={next} onChange={(e) => setNext(e.target.value)} required />
        <input type="password" autoComplete="new-password" placeholder="Repeat new password" value={again} onChange={(e) => setAgain(e.target.value)} required />
        {mismatch && <div className="bad">The two new passwords differ.</div>}
        {error && <div className="bad">{error}</div>}
        {done && <div className="ok">Password changed.</div>}
        <div>
          <button type="submit" className="btn-add" disabled={busy !== null || mismatch || next.length < 12 || !current}>
            {busy ? "…" : "Change password"}
          </button>
        </div>
      </form>
    </section>
  );
}

function MigrateFromStyxRouter() {
  const [srcDb, setSrcDb] = useState("/home/youruser/styx/databases/storage.sqlite");
  const [secret, setSecret] = useState("");
  const [dryRun, setDryRun] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setResult(null);
    try {
      const body = await api.post<{ migrated?: number; failed?: number; backup?: string }>("/api/admin/migrate-from-styx", {
        srcDb,
        srcSecret: secret,
        dryRun,
      });
      const msg =
        `${dryRun ? "DRY " : ""}migrated=${body.migrated ?? 0} ` +
        `failed=${body.failed ?? 0} ` +
        (body.backup ? `backup=${body.backup}` : "");
      setResult(msg);
      toast.success(msg);
    } catch (e: any) {
      const msg = `err: ${e?.message || e}`;
      setResult(msg);
      toast.error(e?.message || "Migration failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="settings-card">
      <h2>Migrate from StyxRouter</h2>
      <p className="muted">
        Re-encrypts credential fields in an external SQLite DB under the StyxRouter salt. A backup is created before any write.
      </p>
      <div style={{ display: "grid", gap: 8, maxWidth: 640 }}>
        <label>
          Source DB path
          <input
            type="text"
            value={srcDb}
            onChange={(e) => setSrcDb(e.target.value)}
            style={{ width: "100%" }}
          />
        </label>
        <label>
          Source secret (STORAGE_ENCRYPTION_KEY)
          <input
            type="password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            style={{ width: "100%" }}
            autoComplete="off"
          />
        </label>
        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} />
          Dry run (count rows but don't rewrite)
        </label>
        <div>
          <button
            type="button"
            className="btn-add"
            disabled={busy || !srcDb || !secret}
            onClick={run}
          >
            {busy ? "…" : "Migrate"}
          </button>
        </div>
        {result && (
          <div className={result.startsWith("err:") ? "bad" : "ok"} style={{ marginTop: 8 }}>
            {result}
          </div>
        )}
      </div>
    </section>
  );
}
