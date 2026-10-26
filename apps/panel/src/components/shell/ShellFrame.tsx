import { useEffect, useState, type ReactNode } from "react";
import { Dialog, DropdownMenu } from "@radix-ui/themes";
import { Menu, X, PanelLeftClose, PanelLeftOpen, ChevronRight, UserRound, Sun, Moon, Monitor } from "lucide-react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { breadcrumbs } from "./breadcrumbs.ts";
import { navigation } from "./navigation.ts";
import { CommandPalette } from "./CommandPalette.tsx";
import { usePreferences } from "../../lib/preferences.tsx";
import type { Language, ThemeMode } from "../../lib/preferences-core.ts";

export function ShellFrame({ brand, logout, children }: { brand: ReactNode; logout: () => void; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);
  const { t, language, setLanguage, theme, setTheme } = usePreferences();
  useEffect(() => setOpen(false), [location]);
  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 861px)");
    const close = () => { if (desktop.matches) setOpen(false); };
    desktop.addEventListener("change", close);
    return () => desktop.removeEventListener("change", close);
  }, []);
  function links() {
    return <>
      {brand}
      {['Gateway', 'Observability', 'System'].map(group => <div className="nav-section" key={group}>
        <div className="nav-section-label">{t(group)}</div>
        {navigation.filter(item => item.group === group).map(({ label, to, icon: Icon }) => <NavLink key={to} to={to} title={t(label)} aria-label={t(label)} end={to === '/'} className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'} onClick={() => setOpen(false)}><Icon size={20} aria-hidden="true" /><span>{t(label)}</span></NavLink>)}
      </div>)}
    </>;
  }
  const crumbs = breadcrumbs(location.pathname);

  return <div className={`shell shell-responsive${collapsed ? " shell-collapsed" : ""}`}>
    <a href="#main-content" className="shell-skip">{t("Skip to content")}</a>
    <nav className="sidebar shell-desktop-sidebar" aria-label="Main navigation">{links()}</nav>
    <div className="shell-workspace">
      <header className="shell-topbar">
        <Dialog.Root open={open} onOpenChange={setOpen}>
          <Dialog.Trigger><button type="button" className="shell-icon-button shell-menu-trigger" aria-label={t("Open navigation")}><Menu size={20} /></button></Dialog.Trigger>
          <Dialog.Content className="shell-drawer" aria-describedby={undefined}>
            <div className="shell-dialog-head"><Dialog.Title className="shell-dialog-title">StyxRouter</Dialog.Title><Dialog.Close><button type="button" className="shell-icon-button" aria-label={t("Close navigation")}><X size={16} /></button></Dialog.Close></div>
            <nav className="sidebar shell-drawer-nav" aria-label="Mobile navigation">{links()}</nav>
          </Dialog.Content>
        </Dialog.Root>
        <button type="button" className="shell-icon-button shell-collapse-trigger" aria-label={t(collapsed ? "Expand sidebar" : "Collapse sidebar")} aria-expanded={!collapsed} onClick={() => setCollapsed(!collapsed)}>{collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}</button>
        {crumbs.length > 1 && <nav className="shell-breadcrumbs" aria-label="Breadcrumb">{crumbs.map((crumb,index) => <span key={index}>{index > 0 && <ChevronRight size={14} />}{crumb.to ? <Link to={crumb.to}>{t(crumb.label)}</Link> : <span aria-current="page">{t(crumb.label)}</span>}</span>)}</nav>}
        <CommandPalette />
        <select className="shell-language" aria-label={t('Language')} value={language} onChange={e => setLanguage(e.target.value as Language)}><option value="en">English</option><option value="id">Indonesia</option></select>
        <DropdownMenu.Root><DropdownMenu.Trigger><button type="button" className="shell-icon-button" aria-label={t('Appearance')}>{theme === 'light' ? <Sun size={20}/> : theme === 'dark' ? <Moon size={20}/> : <Monitor size={20}/>}</button></DropdownMenu.Trigger><DropdownMenu.Content><DropdownMenu.RadioGroup value={theme} onValueChange={v => setTheme(v as ThemeMode)}><DropdownMenu.RadioItem value="light">{t('Light')}</DropdownMenu.RadioItem><DropdownMenu.RadioItem value="dark">{t('Dark')}</DropdownMenu.RadioItem><DropdownMenu.RadioItem value="system">{t('System theme')}</DropdownMenu.RadioItem></DropdownMenu.RadioGroup></DropdownMenu.Content></DropdownMenu.Root>
        <DropdownMenu.Root><DropdownMenu.Trigger><button type="button" className="shell-icon-button" aria-label={t("Session menu")}><UserRound size={17} /></button></DropdownMenu.Trigger><DropdownMenu.Content><DropdownMenu.Label>{t("Administrator session")}</DropdownMenu.Label><DropdownMenu.Item onSelect={() => navigate('/settings')}>{t("Settings")}</DropdownMenu.Item><DropdownMenu.Separator /><DropdownMenu.Item color="red" onSelect={logout}>{t("Sign out")}</DropdownMenu.Item></DropdownMenu.Content></DropdownMenu.Root>
      </header>
      <main className="content" id="main-content" tabIndex={-1}>{children}</main>
    </div>
  </div>;
}
