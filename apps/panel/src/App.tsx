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
