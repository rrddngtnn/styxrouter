import { useEffect, useState } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import { ShellFrame } from "./components/shell/ShellFrame.tsx";
import { api, ApiError } from "./lib/api.ts";

interface AuthStatus {
  authenticated: boolean;
  user?: { username?: string };
}

/**
 * Brand header with a pre-allocated `.brand-logo-slot`. Right now it renders the
 * pure "StyxRouter" wordmark side-by-side; when a logo image is dropped into
 * `.brand-logo-slot`, it aligns next to the text without layout changes.
 */
export function BrandMark() {
  return (
    <div className="brand">
      <span className="brand-logo-slot" aria-hidden="true" />
      <div className="brand-wordmark">
        <strong>Styx</strong>
        <span>Router</span>
      </div>
    </div>
  );
}

export function App() {
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

  if (checking || !authed) return <div className="loading">Checking session…</div>;

  return (
    <ShellFrame brand={<BrandMark />} logout={logout}><Outlet /></ShellFrame>
  );
}
