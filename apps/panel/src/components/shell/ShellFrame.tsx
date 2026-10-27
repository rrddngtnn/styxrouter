import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { DropdownMenu } from "@radix-ui/themes";
import { Menu, X, ChevronRight, UserRound, Sun, Moon, Monitor } from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { BrandMark } from "../BrandMark.tsx";
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

  // While open, the drawer behaves as a modal dialog: focus parks inside it,
  // Tab/Shift+Tab cycle without escaping, Escape dismisses, and the workspace
  // around it is `inert` so the rest of the document is unreachable. It stays
  // CSS-mounted while closed so the exit transition can still play.
  useLayoutEffect(() => {
    if (!nav.open) return;
    const drawer = drawerRef.current;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        nav.close();
        return;
      }
      if (event.key !== "Tab" || !drawer) return;
      // Re-query on every Tab so links added or hidden by navigation state stay
      // in the cycle, and filter to what the browser actually paints.
      const items = Array.from(drawer.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )).filter((el) => el.getClientRects().length > 0);
      if (!items.length) {
        event.preventDefault();
        drawer.focus();
        return;
      }
      const index = items.indexOf(document.activeElement as HTMLElement);
      const wrapping = event.shiftKey ? index <= 0 : index === -1 || index === items.length - 1;
      if (!wrapping) return;
      event.preventDefault();
      (event.shiftKey ? items[items.length - 1] : items[0]).focus();
    };
    // Capture every sibling outside the drawer's branch so the real prior inert
    // flags are restored verbatim on close instead of assumed false.
    const isolated: Array<[HTMLElement, boolean]> = [];
    if (drawer) {
      for (let branch: HTMLElement | null = drawer.parentElement; branch && branch !== document.body; branch = branch.parentElement) {
        for (const sibling of branch.parentElement?.children ?? []) {
          if (sibling === branch || !(sibling instanceof HTMLElement)) continue;
          isolated.push([sibling, sibling.inert]);
          sibling.inert = true;
        }
      }
      const first = drawer.querySelector<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      (first ?? drawer).focus();
    }
    // Focus containment is enforced by the Tab handler above plus `inert` on the
    // workspace. A capture-phase `focusin` retargeter is deliberately absent: it
    // also fires for portalled Radix popovers and would fight them for focus.
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      for (const [element, priorInert] of isolated) element.inert = priorInert;
      triggerRef.current?.focus();
    };
  }, [nav.open, nav.close]);

  const trail = breadcrumbs(location.pathname);

  return <div className="shell shell-responsive">
    <a href="#main-content" className="shell-skip">{t("Skip to content")}</a>

    <div
      className={`shell-nav-scroller${nav.open ? " is-open" : ""}`}
      inert={!nav.open}
      aria-hidden={!nav.open}
      onClick={(event) => {
        if ((event.target as HTMLElement).classList.contains("shell-nav-scroller")) nav.close();
      }}
    >
      <div
        className="shell-drawer"
        role={nav.open ? "dialog" : undefined}
        aria-modal={nav.open || undefined}
        aria-label={t("Main navigation")}
        tabIndex={-1}
        ref={drawerRef}
      >
        <div className="shell-dialog-head">
          <BrandMark />
          <button type="button" className="shell-icon-button" aria-label={t("Close navigation")} onClick={nav.close}>
            <X size={16} />
          </button>
        </div>
        <nav id="styx-nav" className="sidebar shell-drawer-nav" aria-label="Main navigation">
          {brand}
          <NavigationLinks onNavigate={nav.close} />
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
