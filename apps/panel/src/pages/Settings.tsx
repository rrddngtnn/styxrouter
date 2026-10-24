import { useState } from "react";
import { useFetch } from "../lib/useFetch.ts";

type SettingsBag = Record<string, unknown>;

export function Settings() {
  const state = useFetch<SettingsBag>("/api/settings");

  return (
    <div className="page">
      <h1>Settings</h1>
      {state.status === "loading" && <p>Loading…</p>}
      {state.status === "error" && <p className="bad">{state.error.message}</p>}
      {state.status === "ok" && (
        <pre className="json">{JSON.stringify(state.data, null, 2)}</pre>
      )}
      <MigrateFromStyxRouter />
    </div>
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
