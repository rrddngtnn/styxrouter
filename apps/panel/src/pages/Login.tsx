import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { api, ApiError } from "../lib/api.ts";
import { usePreferences } from "../lib/preferences.tsx";
import { BrandMark } from "../components/BrandMark.tsx";
import { RibbonMotif } from "../components/RibbonMotif.tsx";
import "./login.css";

export function Login() {
  const { language } = usePreferences();
  const text = (en: string, id: string) => language === "id" ? id : en;
  const [password, setPassword] = useState("");
  const [error, setError] = useState<{ message: string; rejected: boolean } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const pending = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pending.current || !password) return;
    pending.current = true;
    setError(null);
    setSubmitting(true);
    try {
      await api.post("/api/auth/login", { password });
      setPassword("");
      toast.success(text("Signed in to StyxRouter", "Berhasil masuk ke StyxRouter"));
      // Keep the existing fixed, router-relative destination. Query input cannot redirect.
      navigate("/", { replace: true });
    } catch (err: unknown) {
      const rejected = err instanceof ApiError && err.status === 401;
      let message: string;
      if (!(err instanceof ApiError)) {
        message = text("Unable to connect. Check your connection and try again.", "Tidak dapat terhubung. Periksa koneksi Anda dan coba lagi.");
      } else if (rejected) {
        message = text("Sign-in rejected. Check your management password and try again.", "Proses masuk ditolak. Periksa kata sandi pengelolaan dan coba lagi.");
      } else if (err.status === 429) {
        message = text("Too many failed attempts. Try again later.", "Terlalu banyak percobaan gagal. Coba lagi nanti.");
      } else {
        message = text("Sign-in unavailable. Check the server configuration or try again later.", "Proses masuk tidak tersedia. Periksa konfigurasi server atau coba lagi nanti.");
      }
      setError({ message, rejected });
      input.current?.focus();
    } finally {
      pending.current = false;
      setSubmitting(false);
    }
  }

  return <main className="login-gateway">
    <div className="login-layout">
      <aside className="login-identity" aria-label={text("Management console", "Konsol pengelolaan")}>
        <BrandMark />
        <p className="login-console">{text("Management console", "Konsol pengelolaan")}</p>
        <RibbonMotif className="login-ribbon" />
      </aside>
      <section className="login-form-panel" aria-labelledby="login-title">
        <header><h1 id="login-title">{text("Sign in", "Masuk")}</h1>
          <p id="login-help">{text("Use your administrator password to manage providers, routing, and keys.", "Gunakan kata sandi administrator untuk mengelola penyedia, perutean, dan kunci.")}</p>
        </header>
        <form onSubmit={onSubmit} aria-busy={submitting}>
          <label htmlFor="management-password">{text("Management password", "Kata sandi pengelolaan")}</label>
          <div className="login-password-row">
            <input id="management-password" name="password" ref={input} type={revealed ? "text" : "password"} autoComplete="current-password" autoCapitalize="none" spellCheck={false}
              value={password} onChange={e => setPassword(e.target.value)} required
              aria-invalid={error?.rejected || undefined} aria-describedby={`login-help${error ? " login-error" : ""}${capsLock ? " login-caps" : ""}`}
              onKeyDown={e => { if (typeof e.getModifierState === "function") setCapsLock(e.getModifierState("CapsLock")); }} onBlur={() => setCapsLock(false)} />
            <button className="login-reveal" type="button" aria-controls="management-password" aria-pressed={revealed} onClick={() => setRevealed(v => !v)}>
              {revealed ? text("Hide", "Sembunyikan") : text("Show", "Tampilkan")}
              <span className="sr-only"> {text("password", "kata sandi")}</span>
            </button>
          </div>
          {capsLock && <p id="login-caps" role="status" className="login-caps">{text("Caps Lock is on.", "Caps Lock aktif.")}</p>}
          {error && <p id="login-error" className="login-error" role="alert">{error.message}</p>}
          <button className="login-submit" type="submit" disabled={submitting}>{submitting ? text("Signing in…", "Sedang masuk…") : text("Sign in", "Masuk")}</button>
        </form>
      </section>
    </div>
  </main>;
}
