import { useEffect, useRef, type ReactNode } from "react";
import { DropdownMenu } from "@radix-ui/themes";
import { Menu, X, ChevronRight, UserRound, Sun, Moon, Monitor } from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { BrandMark } from "../../App.tsx";
import { breadcrumbs } from "./breadcrumbs.ts";
import { NavigationLinks } from "./NavigationLinks.tsx";
import { useNavDisclosure } from "./useNavDisclosure.ts";
import { CommandPalette } from "./CommandPalette.tsx";
import { usePreferences } from "../../lib/preferences.tsx";
import type { Language, ThemeMode } from "../../lib/preferences-core.ts";

export function ShellFrame({ brand, logout, children }: { brand: ReactNode; logout: () => void; children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const nav = useNavDisclosure();
  const { t, language, setLanguage, theme, setTheme } = usePreferences();
  const drawerRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  // Route change closes the drawer.
  useEffect(() => nav.close(), [location, nav.close]);

  // Focus management: move focus into the drawer on open, return to the trigger on close.
  useEffect(() => {
    if (nav.open && drawerRef.current) {
      drawerRef.current.focus();
    } else if (!nav.open && triggerRef.current && document.activeElement !== triggerRef.current) {
      // Only restore focus when closing (not on first render).
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nav.open]);

  // Escape closes the drawer and returns focus to the trigger.
  useEffect(() => {
    if (!nav.open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        nav.close();
        triggerRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [nav.open, nav.close]);

  const trail = breadcrumbs(location.pathname);

  return <div className={`shell shell-responsive${nav.collapsed ? " shell-collapsed" : ""}`}>
    <a href="#main-content" className="shell-skip">{t("Skip to content")}</a>

    {/* One nav drawer for every viewport. It slides in the same way on desktop and
        mobile so the disclosure feels identical; the desktop-only collapse toggle
        simply narrows the workspace without changing the drawer animation. */}
    <div
      className={`shell-nav-scroller${nav.open ? " is-open" : ""}`}
      onClick={(event) => {
        if ((event.target as HTMLElement).classList.contains("shell-nav-scroller")) nav.close();
      }}
    >
      <div
        className="shell-drawer"
        role="dialog"
        aria-modal={nav.open || undefined}
        aria-label={t("Main navigation")}
        tabIndex={-1}
        ref={drawerRef}
      >
        <div className="shell-dialog-head">
          <BrandMark />
          <button type="button" className="shell-icon-button" aria-label={t("Close navigation")} onClick={() => { nav.close(); triggerRef.current?.focus(); }}>
            <X size={16} />
          </button>
        </div>
        <nav id="styx-nav" className="sidebar shell-drawer-nav" aria-label="Main navigation">
          {brand}
          <NavigationLinks onNavigate={() => { nav.close(); triggerRef.current?.focus(); }} />
        </nav>
      </div>
    </div>

    <div className="shell-workspace">
      <header className="shell-topbar">
        <button
          type="button"
          className="shell-icon-button shell-nav-trigger"
          aria-label={t(nav.label)}
          aria-expanded={nav.isExpanded}
          aria-controls="styx-nav"
          ref={triggerRef}
          onClick={nav.toggle}
        >
          {nav.isExpanded ? <X size={20} /> : <Menu size={20} />}
        </button>
        <button
          type="button"
          className="shell-icon-button shell-collapse-trigger"
          aria-label={t(nav.collapsed ? "Expand sidebar" : "Collapse sidebar")}
          aria-expanded={!nav.collapsed}
          onClick={nav.collapse}
          hidden={!nav.desktop}
        >
          <ChevronRight size={17} className="icon-rotate" style={{ transform: nav.collapsed ? "rotate(0deg)" : "rotate(180deg)" }} />
        </button>
        {trail.length > 1 && <nav className="shell-breadcrumbs" aria-label="Breadcrumb">{trail.map((step,index) => <span key={index}>{index > 0 && <ChevronRight size={14} />}{step.to ? <Link to={step.to}>{t(step.label)}</Link> : <span aria-current="page">{t(step.label)}</span>}</span>)}</nav>}
        <CommandPalette />
        <select className="shell-language" aria-label={t('Language')} value={language} onChange={e => setLanguage(e.target.value as Language)}><option value="en">English</option><option value="id">Indonesia</option></select>
        <DropdownMenu.Root><DropdownMenu.Trigger><button type="button" className="shell-icon-button" aria-label={t('Appearance')}>{theme === 'light' ? <Sun size={20}/> : theme === 'dark' ? <Moon size={20}/> : <Monitor size={20}/>}</button></DropdownMenu.Trigger><DropdownMenu.Content><DropdownMenu.RadioGroup value={theme} onValueChange={v => setTheme(v as ThemeMode)}><DropdownMenu.RadioItem value="light">{t('Light')}</DropdownMenu.RadioItem><DropdownMenu.RadioItem value="dark">{t('Dark')}</DropdownMenu.RadioItem><DropdownMenu.RadioItem value="system">{t('System theme')}</DropdownMenu.RadioItem></DropdownMenu.RadioGroup></DropdownMenu.Content></DropdownMenu.Root>
        <DropdownMenu.Root><DropdownMenu.Trigger><button type="button" className="shell-icon-button" aria-label={t("Session menu")}><UserRound size={17} /></button></DropdownMenu.Trigger><DropdownMenu.Content><DropdownMenu.Label>{t("Administrator session")}</DropdownMenu.Label><DropdownMenu.Item onSelect={() => navigate('/settings')}>{t("Settings")}</DropdownMenu.Item><DropdownMenu.Separator /><DropdownMenu.Item color="red" onSelect={logout}>{t("Sign out")}</DropdownMenu.Item></DropdownMenu.Content></DropdownMenu.Root>
      </header>
      <main className="content" id="main-content" tabIndex={-1}><div key={location.pathname} className="page-motion">{children}</div></main>
    </div>
  </div>;
}
