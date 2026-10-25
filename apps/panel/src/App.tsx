import { useEffect, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { api, ApiError } from "./lib/api.ts";

interface AuthStatus {
  authenticated: boolean;
  user?: { username?: string };
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
    <div className="shell">
      <nav className="sidebar">
        <div className="brand">
          <strong>Styx</strong>
          <span>Router</span>
        </div>
        <NavLink to="/" end className={navClass}>Dashboard</NavLink>
        <NavLink to="/providers" className={navClass}>Providers</NavLink>
        <NavLink to="/models" className={navClass}>Models</NavLink>
        <NavLink to="/routing" className={navClass}>Routing</NavLink>
        <NavLink to="/keys" className={navClass}>API Keys</NavLink>
        <NavLink to="/activity" className={navClass}>Activity</NavLink>
        <NavLink to="/usage" className={navClass}>Usage</NavLink>
        <NavLink to="/quota" className={navClass}>Quota</NavLink>
        <NavLink to="/tools" className={navClass}>Connect tools</NavLink>
        <NavLink to="/audit" className={navClass}>Audit log</NavLink>
        <NavLink to="/settings" className={navClass}>Settings</NavLink>
        <button type="button" className="logout" onClick={logout}>
          Logout
        </button>
      </nav>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}

function navClass({ isActive }: { isActive: boolean }) {
  return isActive ? "nav-link active" : "nav-link";
}
