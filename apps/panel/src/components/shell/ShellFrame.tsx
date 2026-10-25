import { useEffect, useState, type ReactNode } from "react";
import { Dialog, DropdownMenu } from "@radix-ui/themes";
import { breadcrumbs } from "./breadcrumbs.ts";
import { Menu, X, PanelLeftClose, PanelLeftOpen, ChevronRight, UserRound } from "lucide-react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { navigation } from "./navigation.ts";
import { CommandPalette } from "./CommandPalette.tsx";

export function ShellFrame({ brand, logout, children }: { brand: ReactNode; logout: () => void; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);
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
        <div className="nav-section-label">{group}</div>
        {navigation.filter(item => item.group === group).map(({ label, to, icon: Icon }) => <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'} onClick={() => setOpen(false)}><Icon size={15} aria-hidden="true" /><span>{label}</span></NavLink>)}
      </div>)}

    </>;
  }
  return <div className={`shell shell-responsive${collapsed ? " shell-collapsed" : ""}`}>
    <a href="#main-content" className="shell-skip">Skip to content</a>
    <nav className="sidebar shell-desktop-sidebar" aria-label="Main navigation">{links()}</nav>
    <div className="shell-workspace">
      <header className="shell-topbar">
        <Dialog.Root open={open} onOpenChange={setOpen}>
          <Dialog.Trigger><button type="button" className="shell-icon-button shell-menu-trigger" aria-label="Open navigation"><Menu size={20} /></button></Dialog.Trigger>
          <Dialog.Content className="shell-drawer" aria-describedby={undefined}>
            <div className="shell-dialog-head"><Dialog.Title className="shell-dialog-title">{brand}</Dialog.Title><Dialog.Close><button type="button" className="shell-icon-button" aria-label="Close navigation"><X size={16} /></button></Dialog.Close></div>
            <nav className="sidebar shell-drawer-nav" aria-label="Mobile navigation">{links()}</nav>
          </Dialog.Content>
        </Dialog.Root>
        <button type="button" className="shell-icon-button shell-collapse-trigger" aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} aria-expanded={!collapsed} onClick={() => setCollapsed(!collapsed)}>{collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}</button>
        <nav className="shell-breadcrumbs" aria-label="Breadcrumb">{breadcrumbs(location.pathname).map((crumb,index) => <span key={index}>{index > 0 && <ChevronRight size={12} />}{crumb.to ? <Link to={crumb.to}>{crumb.label}</Link> : <span aria-current="page">{crumb.label}</span>}</span>)}</nav>
        <CommandPalette />
        <DropdownMenu.Root><DropdownMenu.Trigger><button type="button" className="shell-icon-button" aria-label="Session menu"><UserRound size={17} /></button></DropdownMenu.Trigger><DropdownMenu.Content><DropdownMenu.Label>Administrator session</DropdownMenu.Label><DropdownMenu.Item onSelect={() => navigate('/settings')}>Settings</DropdownMenu.Item><DropdownMenu.Separator /><DropdownMenu.Item color="red" onSelect={logout}>Sign out</DropdownMenu.Item></DropdownMenu.Content></DropdownMenu.Root>
      </header>
      <main className="content" id="main-content" tabIndex={-1}>{children}</main>
    </div>
  </div>;
}
