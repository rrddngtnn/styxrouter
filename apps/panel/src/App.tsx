import { useTranslator } from "./lib/useTranslator.ts";
import { useEffect, useState } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import { ShellFrame } from "./components/shell/ShellFrame.tsx";
import { api, ApiError } from "./lib/api.ts";

interface AuthStatus {
  authenticated: boolean;
  user?: { username?: string };
}

/**
 * Icon + live wordmark text. The wordmark is real text (themeable, translatable,
 * crisp at any DPI), so it follows the active light/dark palette instead of the
 * dark SVG lockup that disappeared on dark surfaces.
 */
export function BrandMark({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return (
      <div className="brand brand-compact" role="img" aria-label="StyxRouter" title="StyxRouter">
        <img className="brand-icon" src="brand/styx-icon.svg" alt="" />
      </div>
    );
  }
  return (
    <div className="brand">
      <img className="brand-icon" src="brand/styx-icon.svg" alt="" aria-hidden="true" />
      <span className="brand-wordmark">StyxRouter</span>
    </div>
  );
}

export function App() {
  const tr = useTranslator();
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    api
      .get<AuthStatus>("/api/auth/status")
      .then((status) => {
        if (!status.authenticated) {
          navigate("/login", { replace: true });
          return;
        }
        setAuthed(true);
      })
      .catch((error: unknown) => {
        if (error instanceof ApiError && error.status === 401) {
          navigate("/login", { replace: true });
        }
      })
      .finally(() => setChecking(false));
  }, [navigate]);

  async function logout() {
    await api.post("/api/auth/logout").catch(() => undefined);
    setAuthed(false);
    navigate("/login", { replace: true });
  }

  if (checking || !authed) return <div className="loading">{tr("Checking session…")}</div>;

  return (
    <ShellFrame brand={<BrandMark />} logout={logout}><Outlet /></ShellFrame>
  );
}
