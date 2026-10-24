import { useState } from "react";
import { api } from "../lib/api.ts";
import { SecretBanner, useAction } from "../lib/actions.tsx";
import { useFetch } from "../lib/useFetch.ts";

interface KeyRow {
  id?: string;
  name?: string;
  prefix?: string;
  createdAt?: string;
  lastUsedAt?: string | null;
  modelRestrictions?: string[] | null;
  isActive?: boolean;
}

export function Keys() {
  const state = useFetch<{ keys?: KeyRow[] }>("/api/keys");
  const rows = state.status === "ok" ? state.data.keys ?? [] : [];
  const [name, setName] = useState("");
  const [secret, setSecret] = useState<{ title: string; key: string } | null>(null);
  const { busy, error, run } = useAction(state.reload);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const made = await run("create", () => api.post<{ key: string; name: string }>("/api/keys", { name: name.trim() }));
    if (made) {
      setSecret({ title: `New key “${made.name}”`, key: made.key });
      setName("");
    }
  }

  return (
    <div className="page">
      <h1>API Keys</h1>
      <p className="muted">Keys that clients present as <code>Authorization: Bearer …</code> on /v1. Only a prefix is ever shown after creation.</p>

      {secret && <SecretBanner title={secret.title} secret={secret.key} onDismiss={() => setSecret(null)} />}

      <form className="inline-form" onSubmit={create}>
        <input
          type="text"
          placeholder="Key name (e.g. laptop, ci)"
          value={name}
          maxLength={200}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <button type="submit" className="btn-add" disabled={busy !== null || !name.trim()}>
          {busy === "create" ? "…" : "Create key"}
        </button>
      </form>
      {error && <p className="bad">{error}</p>}

      {state.status === "loading" && <p>Loading…</p>}
      {state.status === "error" && <p className="bad">{state.error.message}</p>}
      {state.status === "ok" && rows.length === 0 && <p className="muted">No API keys issued.</p>}
      {state.status === "ok" && rows.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Prefix</th>
              <th>Created</th>
              <th>Last used</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const id = String(r.id);
              const active = r.isActive !== false;
              return (
                <tr key={id}>
                  <td>{r.name ?? "—"}</td>
                  <td><code>{r.prefix ?? "—"}</code></td>
                  <td>{r.createdAt?.slice(0, 10) ?? "—"}</td>
                  <td>{r.lastUsedAt?.slice(0, 10) ?? "never"}</td>
                  <td className={active ? "ok" : "bad"}>{active ? "active" : "revoked"}</td>
                  <td className="row-actions">
                    {active && (
                      <>
                        <button
                          type="button"
                          className="btn-ghost"
                          disabled={busy !== null}
                          onClick={async () => {
                            const out = await run(
                              `regen-${id}`,
                              () => api.post<{ key: string }>(`/api/keys/${id}/regenerate`),
                              `Regenerate “${r.name}”? The current key stops working immediately.`,
                            );
                            if (out) setSecret({ title: `New key for “${r.name}”`, key: out.key });
                          }}
                        >
                          Regenerate
                        </button>
                        <button
                          type="button"
                          className="btn-ghost"
                          disabled={busy !== null}
                          onClick={() => run(`revoke-${id}`, () => api.post(`/api/keys/${id}/revoke`), `Revoke “${r.name}”?`)}
                        >
                          Revoke
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      className="btn-danger"
                      disabled={busy !== null}
                      onClick={() => run(`delete-${id}`, () => api.delete(`/api/keys/${id}`), `Delete “${r.name}” permanently?`)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
