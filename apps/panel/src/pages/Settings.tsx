import { useState } from "react";
import { api } from "../lib/api.ts";
import { useAction } from "../lib/actions.tsx";
import { useFetch } from "../lib/useFetch.ts";

type SettingsBag = Record<string, unknown>;

export function Settings() {
  const state = useFetch<SettingsBag>("/api/settings");

  return (
    <div className="page">
      <h1>Settings</h1>
      <ChangePassword />
      <h2>Current values</h2>
      {state.status === "loading" && <p>Loading…</p>}
      {state.status === "error" && <p className="bad">{state.error.message}</p>}
      {state.status === "ok" && (
        <pre className="json">{JSON.stringify(state.data, null, 2)}</pre>
      )}
      <MigrateFromStyxRouter />
    </div>
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
      const r = await fetch("/api/admin/migrate-from-styx", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ srcDb, srcSecret: secret, dryRun }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body?.error || `http ${r.status}`);
      setResult(
        `${dryRun ? "DRY " : ""}migrated=${body.migrated ?? 0} ` +
          `failed=${body.failed ?? 0} ` +
          (body.backup ? `backup=${body.backup}` : ""),
      );
    } catch (e: any) {
      setResult(`err: ${e?.message || e}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section style={{ marginTop: 32, padding: 16, border: "1px solid #333", borderRadius: 6 }}>
      <h2 style={{ marginTop: 0 }}>Migrate from StyxRouter</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        Re-encrypts credential fields in an StyxRouter SQLite DB under the
        StyxRouter salt. A backup is created before any write.
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
