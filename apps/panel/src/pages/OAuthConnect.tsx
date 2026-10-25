import { useEffect, useState } from "react";
import { api } from "../lib/api.ts";
import { useAction } from "../lib/actions.tsx";

export type FlowType = "authorization_code" | "authorization_code_pkce" | "device_code" | "import_token";

type Json = Record<string, unknown>;
const text = (v: unknown) => (typeof v === "string" && v ? v : undefined);
const drop = (o: Json) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null)) as never;

/** Connect one OAuth account. The flow depends on the provider; all of them end in a saved account. */
export function OAuthConnect({ provider, flow, legacyDevice, onDone, onClose }: { provider: string; flow: FlowType; legacyDevice?: boolean; onDone: () => void; onClose: () => void }) {
  const finish = () => {
    onDone();
    onClose();
  };
  return (
    <div className="editor">
      {flow === "device_code" ? (
        <DeviceFlow provider={provider} legacy={legacyDevice === true} onDone={finish} />
      ) : flow === "import_token" ? (
        <TokenImport provider={provider} onDone={finish} />
      ) : (
        <CodeFlow provider={provider} onDone={finish} />
      )}
      <div>
        <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}

/** Sign in at the vendor, then paste back the address the browser lands on (it points at localhost and will not load). */
function CodeFlow({ provider, onDone }: { provider: string; onDone: () => void }) {
  const [auth, setAuth] = useState<Json | null>(null);
  const [pasted, setPasted] = useState("");
  const { busy, error, run } = useAction();

  async function start() {
    const d = await run("start", () => api.get<Json>(`/api/oauth/${provider}/authorize`));
    if (!d) return;
    const url = text(d.authUrl);
    if (!url) return void setAuth({ unsupported: text(d.error) ?? "This provider cannot start a browser login." });
    window.open(url, "_blank", "noopener");
    setAuth(d);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!auth) return;
    let code = pasted.trim();
    let state = text(auth.state);
    try {
      const u = new URL(code);
      code = u.searchParams.get("code") ?? "";
      state = u.searchParams.get("state") ?? state;
    } catch {
      // not a URL: the user pasted the bare code
    }
    if (!code) return;
    const done = await run("exchange", () =>
      api.post(`/api/oauth/${provider}/exchange`, drop({ code, redirectUri: text(auth.redirectUri) ?? "http://localhost:8080/callback", codeVerifier: text(auth.codeVerifier), state })),
    );
    if (done) onDone();
  }

  return (
    <>
      {!auth && (
        <>
          <p className="muted">Opens the vendor login in a new tab. Sign in, then come back here.</p>
          <div><button type="button" className="btn-add" disabled={busy !== null} onClick={start}>{busy ? "..." : "Open login page"}</button></div>
        </>
      )}
      {auth?.unsupported ? <p className="bad">{String(auth.unsupported)}</p> : null}
      {auth && !auth.unsupported && (
        <form className="stack-form" onSubmit={submit}>
          <p className="muted">
            After you sign in, the browser is sent to an address that starts with <code>http://localhost</code> and usually shows an error page.
            That is expected: copy the whole address from the address bar and paste it here.
          </p>
          <textarea rows={3} placeholder="http://localhost:.../callback?code=..." value={pasted} onChange={(e) => setPasted(e.target.value)} required />
          <div><button type="submit" className="btn-add" disabled={busy !== null || !pasted.trim()}>{busy ? "..." : "Connect"}</button></div>
        </form>
      )}
      {error && <p className="bad">{error}</p>}
    </>
  );
}

/**
 * Show a code and a link; the server is polled until the user approves on the vendor side. Providers with `legacy` set go
 * through the older /init + /poll routes (they keep per-session secrets server-side and map zai -> glm); the rest use the
 * generic device-code / poll actions.
 */
function DeviceFlow({ provider, legacy, onDone }: { provider: string; legacy: boolean; onDone: () => void }) {
  const [dev, setDev] = useState<Json | null>(null);
  const [status, setStatus] = useState("");
  const { busy, error, run } = useAction();

  // Same shape as the generic device-code response, so the rest of the component does not care which route answered.
  const startLegacy = async (): Promise<Json> => {
    const r = await api.post<Json>(`/api/oauth/${provider}/init`);
    return { device_code: r.state, user_code: r.userCode, verification_uri_complete: r.authUrl, interval: r.interval, expires_in: r.expiresIn };
  };

  const deviceCode = dev ? text(dev.device_code) ?? text(dev.deviceCode) : undefined;
  const userCode = dev ? text(dev.user_code) ?? text(dev.userCode) : undefined;
  const link = dev ? text(dev.verification_uri_complete) ?? text(dev.verificationUriComplete) ?? text(dev.verification_uri) ?? text(dev.verificationUri) : undefined;

  useEffect(() => {
    if (!dev || !deviceCode) return;
    let stop = false;
    const every = Math.max(3, Number(dev.interval) || 5) * 1000;
    const until = Date.now() + (Number(dev.expires_in) || 900) * 1000;
    const tick = async () => {
      while (!stop && Date.now() < until) {
        await new Promise((r) => setTimeout(r, every));
        if (stop) return;
        try {
          const r = legacy
            ? await api.get<Json>(`/api/oauth/${provider}/poll?state=${encodeURIComponent(deviceCode)}`)
            : await api.post<Json>(`/api/oauth/${provider}/poll`, drop({ deviceCode, codeVerifier: text(dev.codeVerifier), extraData: dev.extraData as never }));
          if (r.success || r.ok) return void onDone();
          if (!r.pending && !legacy) return void setStatus(text(r.errorDescription) ?? text(r.error) ?? "The vendor rejected the login.");
          setStatus("Waiting for you to approve...");
        } catch (e) {
          return void setStatus(e instanceof Error ? e.message : String(e));
        }
      }
      if (!stop) setStatus("The code expired. Cancel and start again.");
    };
    void tick();
    return () => {
      stop = true;
    };
  }, [dev]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      {!dev && (
        <>
          <p className="muted">You will get a short code to type on the vendor's page.</p>
          <div><button type="button" className="btn-add" disabled={busy !== null} onClick={async () => { const d = await run("start", () => (legacy ? startLegacy() : api.get<Json>(`/api/oauth/${provider}/device-code`))); if (d) setDev(d); }}>{busy ? "..." : "Get code"}</button></div>
        </>
      )}
      {dev && (
        <>
          {userCode && <p>Code: <code className="secret-value">{userCode}</code></p>}
          {link && <p><a href={link} target="_blank" rel="noopener noreferrer">Open the vendor page</a>, enter the code and approve.</p>}
          <p className="muted">{status || "Waiting for you to approve..."}</p>
        </>
      )}
      {error && <p className="bad">{error}</p>}
    </>
  );
}

/** Providers that hand you a token instead of a login screen. */
function TokenImport({ provider, onDone }: { provider: string; onDone: () => void }) {
  const [token, setToken] = useState("");
  const { busy, error, run } = useAction();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const raw = token.trim();
    let value: unknown = raw;
    if (raw.startsWith("{")) {
      try {
        value = JSON.parse(raw);
      } catch {
        // keep as text; the server will say if it is unusable
      }
    }
    const done = await run("import", () => api.post(`/api/oauth/${provider}/import-token`, { token: value as never }));
    if (done) onDone();
  }

  return (
    <form className="stack-form" onSubmit={submit}>
      <p className="muted">Paste the token (or the JSON the vendor's tool saved). It is stored encrypted.</p>
      <textarea rows={4} autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} required />
      {error && <p className="bad">{error}</p>}
      <div><button type="submit" className="btn-add" disabled={busy !== null || !token.trim()}>{busy ? "..." : "Import"}</button></div>
    </form>
  );
}
