import { useTranslator } from "../lib/useTranslator.ts";
import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api.ts";
/** Own each flow request; cancellation never retries a potentially committed exchange. */
function useFlowAction() {
  const controller = useRef(new AbortController());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const running = useRef(false);
  useEffect(() => {
    if (controller.current.signal.aborted) controller.current = new AbortController();
    const current = controller.current;
    return () => { current.abort(); };
  }, []);
  async function run<T>(label: string, request: (signal: AbortSignal) => Promise<T>) {
    const signal = controller.current.signal;
    if (signal.aborted || running.current) return;
    running.current = true;
    setBusy(label); setError(null);
    try { const result = await request(signal); return signal.aborted ? undefined : result; }
    catch (error) { if (!signal.aborted) setError(error instanceof Error ? error.message : String(error)); }
    finally { running.current = false; if (!signal.aborted) setBusy(null); }
    return undefined;
  }
  return {busy, error, run, signal: controller.current.signal};
}

export type FlowType = "authorization_code" | "authorization_code_pkce" | "device_code" | "import_token";

type Json = Record<string, unknown>;
const text = (v: unknown) => (typeof v === "string" && v ? v : undefined);
const drop = (o: Json) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null)) as never;

/** Connect one OAuth account. The flow depends on the provider; all of them end in a saved account. */
export function OAuthConnect({ provider, flow, legacyDevice, redirectUri, onDone, onClose }: { provider: string; flow: FlowType; legacyDevice?: boolean; redirectUri?: string; onDone: () => void; onClose: () => void }) {
  const tr = useTranslator();
  const active = useRef(true);
  const [cancelled, setCancelled] = useState(false);
  const cancel = () => { active.current = false; setCancelled(true); onClose(); };
  const pendingFinish = useRef(false);
  const finish = () => {
    if (!active.current) return;
    if (document.hidden) { pendingFinish.current = true; return; }
    active.current = false;
    onDone();
    onClose();
  };
  useEffect(() => {
    active.current = true;
    const visible = () => { if (!document.hidden && pendingFinish.current) finish(); };
    document.addEventListener("visibilitychange", visible);
    return () => { active.current = false; document.removeEventListener("visibilitychange", visible); };
  }, []);
  if (cancelled) return null;
  return (
    <div className="editor">
      {flow === "device_code" ? (
        <DeviceFlow key={`${provider}:${legacyDevice}`} provider={provider} legacy={legacyDevice === true} onDone={finish} />
      ) : flow === "import_token" ? (
        <TokenImport key={provider} provider={provider} onDone={finish} />
      ) : (
        <CodeFlow key={`${provider}:${redirectUri}`} provider={provider} redirectUri={redirectUri} onDone={finish} />
      )}
      <div>
        <button type="button" className="btn-ghost" onClick={cancel}>{tr("Cancel")}</button>
      </div>
    </div>
  );
}

/** Sign in at the vendor, then paste back the address the browser lands on (it points at localhost and will not load). */
function CodeFlow({ provider, redirectUri, onDone }: { provider: string; redirectUri?: string; onDone: () => void }) {
  const tr = useTranslator();
  const [auth, setAuth] = useState<Json | null>(null);
  const [pasted, setPasted] = useState("");
  const { busy, error, run } = useFlowAction();

  async function start() {
    const d = await run("start", signal => api.get<Json>(`/api/oauth/${provider}/authorize${redirectUri ? `?redirect_uri=${encodeURIComponent(redirectUri)}` : ""}`, signal));
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
    const done = await run("exchange", signal =>
      api.post(`/api/oauth/${provider}/exchange`, drop({ code, redirectUri: text(auth.redirectUri) ?? "http://localhost:8080/callback", codeVerifier: text(auth.codeVerifier), state }), signal),
    );
    if (done) onDone();
  }

  return (
    <>
      {!auth && (
        <>
          <p className="muted">{tr("Opens the vendor login in a new tab. Sign in, then come back here.")}</p>
          <div><button type="button" className="btn-add" disabled={busy !== null} onClick={start}>{busy ? "..." : tr("Open login page")}</button></div>
        </>
      )}
      {auth?.unsupported ? <p className="bad">{String(auth.unsupported)}</p> : null}
      {auth && !auth.unsupported && (
        <form className="stack-form" onSubmit={submit}>
          {text(auth.authUrl) && (
            <p>
              <a href={text(auth.authUrl)} target="_blank" rel="noopener noreferrer">{tr("Open login page")}</a>{" "}{tr("(if the tab did not open automatically).")}</p>
          )}
          <p className="muted">{tr("After you sign in, the browser is sent to an address that starts with")}<code>http://localhost</code>{tr("and usually shows an error page. That is expected: copy the whole address from the address bar and paste it here.")}</p>
          <textarea rows={3} placeholder="http://localhost:.../callback?code=..." value={pasted} onChange={(e) => setPasted(e.target.value)} required />
          <div><button type="submit" className="btn-add" disabled={busy !== null || !pasted.trim()}>{busy ? "..." : tr("Connect")}</button></div>
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
  const tr = useTranslator();
  const [dev, setDev] = useState<Json | null>(null);
  const [status, setStatus] = useState("");
  const { busy, error, run } = useFlowAction();

  // Same shape as the generic device-code response, so the rest of the component does not care which route answered.
  const startLegacy = async (signal: AbortSignal): Promise<Json> => {
    const r = await api.post<Json>(`/api/oauth/${provider}/init`, undefined, signal);
    return { device_code: r.state, user_code: r.userCode, verification_uri_complete: r.authUrl, interval: r.interval, expires_in: r.expiresIn };
  };

  const deviceCode = dev ? text(dev.device_code) ?? text(dev.deviceCode) : undefined;
  const userCode = dev ? text(dev.user_code) ?? text(dev.userCode) : undefined;
  const link = dev ? text(dev.verification_uri_complete) ?? text(dev.verificationUriComplete) ?? text(dev.verification_uri) ?? text(dev.verificationUri) : undefined;
  const extraData = dev
    ? (dev.extraData ??
      Object.fromEntries(Object.entries(dev).filter(([k, v]) => k.startsWith("_") && v !== undefined && v !== null)))
    : undefined;

  useEffect(() => {
    if (!dev || !deviceCode) return;
    let stop = false;
    const controller = new AbortController();

    const every = Math.max(3, Number(dev.interval) || 5) * 1000;
    const until = Date.now() + (Number(dev.expires_in) || 900) * 1000;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let wake: (() => void) | undefined;
    const tick = async () => {
      while (!stop && Date.now() < until) {
        await new Promise<void>((resolve) => { wake = resolve; timer = setTimeout(resolve, every); });
        if (stop) return;
        if (document.hidden) continue;
        try {
          const r = legacy
            ? await api.get<Json>(`/api/oauth/${provider}/poll?state=${encodeURIComponent(deviceCode)}`, controller.signal)
            : await api.post<Json>(`/api/oauth/${provider}/poll`, drop({ deviceCode, codeVerifier: text(dev.codeVerifier), extraData: (extraData && Object.keys(extraData as object).length ? extraData : undefined) as never }), controller.signal);
          if (stop || controller.signal.aborted) return;
          if (r.success || r.ok) return void onDone();
          if (!r.pending && !legacy) return void setStatus(text(r.errorDescription) ?? text(r.error) ?? "The vendor rejected the login.");
          setStatus("Waiting for you to approve...");
        } catch (e) {
          if (stop || controller.signal.aborted) return;
          return void setStatus(e instanceof Error ? e.message : String(e));
        }
      }
      if (!stop) setStatus("The code expired. Cancel and start again.");
    };
    void tick();
    return () => {
      stop = true; controller.abort();
      clearTimeout(timer); wake?.();

    };
  }, [dev]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      {!dev && (
        <>
          <p className="muted">{tr("You will get a short code to type on the vendor's page.")}</p>
          <div><button type="button" className="btn-add" disabled={busy !== null} onClick={async () => { const d = await run("start", signal => (legacy ? startLegacy(signal) : api.get<Json>(`/api/oauth/${provider}/device-code`, signal))); if (d) setDev(d); }}>{busy ? "..." : tr("Get code")}</button></div>
        </>
      )}
      {dev && (
        <>
          {userCode && <p>{tr("Code:")}<code className="secret-value">{userCode}</code></p>}
          {link && <p><a href={link} target="_blank" rel="noopener noreferrer">{tr("Open the vendor page")}</a>{tr(", enter the code and approve.")}</p>}
          <p className="muted">{status || tr("Waiting for you to approve...")}</p>
        </>
      )}
      {error && <p className="bad">{error}</p>}
    </>
  );
}

/** Providers that hand you a token instead of a login screen. */
function TokenImport({ provider, onDone }: { provider: string; onDone: () => void }) {
  const tr = useTranslator();
  const [token, setToken] = useState("");
  const { busy, error, run } = useFlowAction();

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
    const done = await run("import", signal => api.post(`/api/oauth/${provider}/import-token`, { token: value as never }, signal));
    if (done) onDone();
  }

  return (
    <form className="stack-form" onSubmit={submit}>
      <p className="muted">{tr("Paste the token (or the JSON the vendor's tool saved). It is stored encrypted.")}</p>
      <textarea rows={4} autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} required />
      {error && <p className="bad">{error}</p>}
      <div><button type="submit" className="btn-add" disabled={busy !== null || !token.trim()}>{busy ? "..." : tr("Import")}</button></div>
    </form>
  );
}
