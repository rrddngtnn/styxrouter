import { useEffect, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import {
  Activity as ActivityIcon,
  BarChart3,
  Cpu,
  Database,
  Gauge,
  GitBranch,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Settings as SettingsIcon,
  ShieldCheck,
  Terminal,
} from "lucide-react";
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
    <div className="shell">
      <nav className="sidebar" aria-label="Main navigation">
        <BrandMark />

        <div className="nav-section">
          <div className="nav-section-label">Gateway</div>
          <NavLink to="/" end className={navClass}>
            <LayoutDashboard size={15} />
            <span>Overview</span>
          </NavLink>
          <NavLink to="/providers" className={navClass}>
            <Database size={15} />
            <span>Providers</span>
          </NavLink>
          <NavLink to="/models" className={navClass}>
            <Cpu size={15} />
            <span>Models</span>
          </NavLink>
          <NavLink to="/routing" className={navClass}>
            <GitBranch size={15} />
            <span>Routing</span>
          </NavLink>
          <NavLink to="/keys" className={navClass}>
            <KeyRound size={15} />
            <span>API Keys</span>
          </NavLink>
        </div>

        <div className="nav-section">
          <div className="nav-section-label">Observability</div>
          <NavLink to="/quota" className={navClass}>
            <Gauge size={15} />
            <span>Quota</span>
          </NavLink>
          <NavLink to="/usage" className={navClass}>
            <BarChart3 size={15} />
            <span>Usage</span>
          </NavLink>
          <NavLink to="/activity" className={navClass}>
            <ActivityIcon size={15} />
            <span>Activity</span>
          </NavLink>
        </div>

        <div className="nav-section">
          <div className="nav-section-label">System</div>
          <NavLink to="/tools" className={navClass}>
            <Terminal size={15} />
            <span>Connect tools</span>
          </NavLink>
          <NavLink to="/audit" className={navClass}>
            <ShieldCheck size={15} />
            <span>Audit log</span>
          </NavLink>
          <NavLink to="/settings" className={navClass}>
            <SettingsIcon size={15} />
            <span>Settings</span>
          </NavLink>
        </div>

        <button type="button" className="logout" onClick={logout}>
          <LogOut size={14} />
          <span>Sign out</span>
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
