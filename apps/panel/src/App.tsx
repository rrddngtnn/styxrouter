import { useTranslator } from "./lib/useTranslator.ts";
import { useEffect, useState } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import { ShellFrame } from "./components/shell/ShellFrame.tsx";
import { api, ApiError } from "./lib/api.ts";

interface AuthStatus {
  authenticated: boolean;
  user?: { username?: string };
}

import { BrandMark } from "./components/BrandMark.tsx";
export { BrandMark } from "./components/BrandMark.tsx";

export function App() {
  const tr = useTranslator();
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);
  const [authed, setAuthed] = useState(false);
  const [checkFailed, setCheckFailed] = useState(false);
  const [checkAttempt, setCheckAttempt] = useState(0);

  useEffect(() => {
    setChecking(true);
    setCheckFailed(false);
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
        } else {
          setCheckFailed(true);
        }
      })
      .finally(() => setChecking(false));
  }, [navigate, checkAttempt]);

  async function logout() {
    await api.post("/api/auth/logout").catch(() => undefined);
    setAuthed(false);
    navigate("/login", { replace: true });
  }

  if (checkFailed) return <div className="loading" role="alert"><p>{tr("Unable to check session.")}</p><button type="button" onClick={() => setCheckAttempt((attempt) => attempt + 1)}>{tr("Retry")}</button></div>;
  if (checking || !authed) return <div className="loading">{tr("Checking session…")}</div>;

  return (
    <ShellFrame brand={<BrandMark />} logout={logout}><Outlet /></ShellFrame>
  );
}
