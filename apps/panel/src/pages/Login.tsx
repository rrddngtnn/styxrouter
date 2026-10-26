import { useTranslator } from "../lib/useTranslator.ts";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Lock } from "lucide-react";
import { toast } from "sonner";
import { api, ApiError } from "../lib/api.ts";
import { BrandMark } from "../App.tsx";

export function Login() {
  const tr = useTranslator();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await api.post("/api/auth/login", { password });
      toast.success("Signed in to StyxRouter");
      navigate("/", { replace: true });
    } catch (err: unknown) {
      const msg = err instanceof ApiError ? err.message : "Login failed";
      setError(msg);
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={onSubmit}>
        <div className="login-head">
          <BrandMark />
          <p className="muted" style={{ margin: "6px 0 0", fontSize: "13px" }}>{tr("Sign in with your administrator passphrase to manage providers, routing, and keys.")}</p>
        </div>
        <label>
          <span>{tr("Management password")}</span>
          <input
            type="password"
            autoComplete="current-password"
            placeholder="••••••••••••"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        {error && <div className="error">{error}</div>}
        <button type="submit" disabled={submitting}>
          <Lock size={14} />
          <span>{submitting ? tr("Signing in…") : tr("Sign in")}</span>
        </button>
      </form>
    </div>
  );
}
