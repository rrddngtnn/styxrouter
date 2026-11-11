import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { DropdownMenu } from "@radix-ui/themes";
import { X, PanelLeftClose, PanelLeftOpen, ChevronRight, UserRound, Sun, Moon, Monitor } from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { BrandMark } from "../BrandMark.tsx";
import { breadcrumbs } from "./breadcrumbs.ts";
import { NavigationLinks } from "./NavigationLinks.tsx";
import { DecorativeGeometry } from "./DecorativeGeometry.tsx";
import { useNavDisclosure } from "./useNavDisclosure.ts";
import { CommandPalette } from "./CommandPalette.tsx";
import { usePreferences } from "../../lib/preferences.tsx";
import "./responsive-navigation.css";
import type { Density, Language, ThemeMode } from "../../lib/preferences-core.ts";

export function ShellFrame({ brand, logout, children }: { brand: ReactNode; logout: () => void; children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const nav = useNavDisclosure();
  const { t, language, setLanguage, theme, setTheme, density, setDensity } = usePreferences();
  const drawerRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  // Route change closes the drawer.
  useEffect(() => nav.close(), [location, nav.close]);

  // While open, the drawer behaves as a modal dialog: focus parks inside it,
  // Tab/Shift+Tab cycle without escaping, Escape dismisses, and the workspace
  // around it is `inert` so the rest of the document is unreachable. It stays
  // CSS-mounted while closed so the exit transition can still play.
  useLayoutEffect(() => {
    if (nav.desktop || !nav.open) return;
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
  }, [nav.open, nav.desktop, nav.close]);

  // Track real input events across route renders; never infer modality from a timer
  // or :focus-visible (browsers may inherit that state from the previous owner).
  const routeInput = useRef<'keyboard' | 'programmatic'>('programmatic');
  const routeOpener = useRef<Element | null>(null);
  const routeActivation = useRef<'keyboard' | 'programmatic' | null>(null);
  useLayoutEffect(() => {
    const clearMarker = () => document.querySelectorAll('h1[data-route-focus]').forEach(el => el.removeAttribute('data-route-focus'));
    const key = (event: KeyboardEvent) => {
      if (['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) return;
      routeInput.current = 'keyboard';
      clearMarker();
      if (event.key==='Enter' || event.key===' ') routeActivation.current='keyboard';
    };
    const pointer = () => { routeInput.current = 'programmatic'; routeActivation.current=null; };
    const activation = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target.closest('a[href], [role="option"], [role="menuitem"]') : null;
      routeOpener.current = target;
      if(target) routeActivation.current=routeInput.current;
    };
    const focus = (event: FocusEvent) => {
      document.querySelectorAll('h1[data-route-focus]').forEach(el => { if (el !== event.target) el.removeAttribute('data-route-focus'); });
    };
    document.addEventListener('keydown', key, true);
    document.addEventListener('pointerdown', pointer, true);
    document.addEventListener('click', activation, true);
    document.addEventListener('focusin', focus, true);
    return () => {
      document.removeEventListener('keydown', key, true);
      document.removeEventListener('pointerdown', pointer, true);
      document.removeEventListener('click', activation, true);
      document.removeEventListener('focusin', focus, true);
    };
  }, []);

  useLayoutEffect(() => {
    let completed=false, interacted=false;
    const modality=routeActivation.current ?? 'programmatic';
    routeActivation.current=null;
    const opener=routeOpener.current;
    routeOpener.current=null;
    const onInteraction=()=>{interacted=true;};
    const finish=()=>{
      if(completed)return;
      const heading=document.querySelector<HTMLElement>('#main-content h1');
      if(!heading)return;
      completed=true;
      document.title=`${heading.textContent} — StyxRouter`;
      const focusOwner=document.activeElement;
      const navigationFocus=opener && (focusOwner===opener || (focusOwner===triggerRef.current && drawerRef.current?.contains(opener)));
      const unownedFocus=!focusOwner || focusOwner===document.body || focusOwner===document.getElementById('main-content') || focusOwner===heading || navigationFocus;
      if(!interacted && unownedFocus){
        heading.tabIndex=-1;
        if(modality==='programmatic') heading.dataset.routeFocus='programmatic';
        else heading.removeAttribute('data-route-focus');
        heading.focus({preventScroll:true});
      }
    };
    const onReady=(event:Event)=>{if((event as CustomEvent<string>).detail===location.pathname)finish();};
    document.addEventListener('styx:page-ready',onReady);
    document.addEventListener('pointerdown',onInteraction,true);
    document.addEventListener('keydown',onInteraction,true);
    finish();
    return ()=>{
      document.removeEventListener('styx:page-ready',onReady);
      document.removeEventListener('pointerdown',onInteraction,true);
      document.removeEventListener('keydown',onInteraction,true);
    };
  }, [location.pathname]);
  const trail = breadcrumbs(location.pathname);

  return <div className="shell shell-responsive">
    <a href="#main-content" className="shell-skip">{t("Skip to content")}</a>

    <div
      className={`shell-nav-scroller${nav.open ? " is-open" : ""}${nav.desktop ? " is-desktop" : ""}${nav.desktop && !nav.isExpanded ? " is-collapsed" : ""}`}
      inert={!nav.desktop && !nav.open}
      aria-hidden={!nav.desktop && !nav.open}
      onClick={(event) => {
        if ((event.target as HTMLElement).classList.contains("shell-nav-scroller")) nav.close();
      }}
    >
      <div
        className="shell-drawer"
        role={!nav.desktop && nav.open ? "dialog" : undefined}
        aria-modal={(!nav.desktop && nav.open) || undefined}
        aria-label={t("Main navigation")}
        tabIndex={-1}
        ref={drawerRef}
      >
        <div className="shell-dialog-head">
          <BrandMark />
          {<button type="button" className="shell-icon-button" aria-label={t("Close navigation")} onClick={nav.close}>
            <X size={16} />
          </button>}
        </div>
        <nav id="styx-nav" className="sidebar shell-drawer-nav" aria-label={t("Main navigation")}>
          {brand}
          <NavigationLinks onNavigate={nav.close} />
          <DecorativeGeometry />
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
          {nav.isExpanded ? <PanelLeftClose size={20} /> : <PanelLeftOpen size={20} />}
        </button>
        {trail.length > 1 && <nav className="shell-breadcrumbs" aria-label="Breadcrumb"><ol>{trail.map((step,index) => <li key={index}>{index > 0 && <ChevronRight size={14} aria-hidden="true" />}{step.to ? <Link to={step.to}>{t(step.label)}</Link> : <span aria-current="page" title={t(step.label)}>{t(step.label)}</span>}</li>)}</ol></nav>}
        <Link to="/" className="shell-product" aria-label="StyxRouter"><BrandMark /><img className="shell-product-icon" src={`${import.meta.env.BASE_URL}brand/styx-icon.svg`} alt="" /></Link>
        <CommandPalette />
        <DropdownMenu.Root><DropdownMenu.Trigger><button type="button" className="shell-icon-button shell-mobile-utilities" aria-label={t("Preferences and session")}>⋯</button></DropdownMenu.Trigger><DropdownMenu.Content>
          <DropdownMenu.Label>{t("Language")}</DropdownMenu.Label><DropdownMenu.RadioGroup value={language} onValueChange={v=>setLanguage(v as Language)}><DropdownMenu.RadioItem value="en">English</DropdownMenu.RadioItem><DropdownMenu.RadioItem value="id">Indonesia</DropdownMenu.RadioItem></DropdownMenu.RadioGroup>
          <DropdownMenu.Separator/><DropdownMenu.Label>{t("Appearance")}</DropdownMenu.Label><DropdownMenu.RadioGroup value={theme} onValueChange={v=>setTheme(v as ThemeMode)}><DropdownMenu.RadioItem value="light">{t("Light")}</DropdownMenu.RadioItem><DropdownMenu.RadioItem value="dark">{t("Dark")}</DropdownMenu.RadioItem><DropdownMenu.RadioItem value="system">{t("System theme")}</DropdownMenu.RadioItem></DropdownMenu.RadioGroup>
          <DropdownMenu.Separator/><DropdownMenu.Label>{t("Density")}</DropdownMenu.Label><DropdownMenu.RadioGroup value={density} onValueChange={v=>setDensity(v as Density)}><DropdownMenu.RadioItem value="comfortable">{t("Comfortable")}</DropdownMenu.RadioItem><DropdownMenu.RadioItem value="compact">{t("Compact")}</DropdownMenu.RadioItem></DropdownMenu.RadioGroup>
          <DropdownMenu.Separator/><DropdownMenu.Item onSelect={()=>navigate('/settings')}>{t("Settings")}</DropdownMenu.Item><DropdownMenu.Item color="red" onSelect={logout}>{t("Sign out")}</DropdownMenu.Item>
        </DropdownMenu.Content></DropdownMenu.Root>
        <select className="shell-language" aria-label={t('Language')} value={language} onChange={e => setLanguage(e.target.value as Language)}><option value="en">English</option><option value="id">Indonesia</option></select>
        <DropdownMenu.Root><DropdownMenu.Trigger><button type="button" className="shell-icon-button" aria-label={t('Appearance')}>{theme === 'light' ? <Sun size={20}/> : theme === 'dark' ? <Moon size={20}/> : <Monitor size={20}/>}</button></DropdownMenu.Trigger><DropdownMenu.Content><DropdownMenu.RadioGroup value={theme} onValueChange={v => setTheme(v as ThemeMode)}><DropdownMenu.RadioItem value="light">{t('Light')}</DropdownMenu.RadioItem><DropdownMenu.RadioItem value="dark">{t('Dark')}</DropdownMenu.RadioItem><DropdownMenu.RadioItem value="system">{t('System theme')}</DropdownMenu.RadioItem></DropdownMenu.RadioGroup></DropdownMenu.Content></DropdownMenu.Root>
        <DropdownMenu.Root><DropdownMenu.Trigger><button type="button" className="shell-icon-button" aria-label={t('Density')}><span aria-hidden="true">↕</span></button></DropdownMenu.Trigger><DropdownMenu.Content><DropdownMenu.RadioGroup value={density} onValueChange={v=>setDensity(v as Density)}><DropdownMenu.RadioItem value="comfortable">{t('Comfortable')}</DropdownMenu.RadioItem><DropdownMenu.RadioItem value="compact">{t('Compact')}</DropdownMenu.RadioItem></DropdownMenu.RadioGroup></DropdownMenu.Content></DropdownMenu.Root>
        <DropdownMenu.Root><DropdownMenu.Trigger><button type="button" className="shell-icon-button" aria-label={t("Session menu")}><UserRound size={17} /></button></DropdownMenu.Trigger><DropdownMenu.Content><DropdownMenu.Label>{t("Administrator session")}</DropdownMenu.Label><DropdownMenu.Item onSelect={() => navigate('/settings')}>{t("Settings")}</DropdownMenu.Item><DropdownMenu.Separator /><DropdownMenu.Item color="red" onSelect={logout}>{t("Sign out")}</DropdownMenu.Item></DropdownMenu.Content></DropdownMenu.Root>
      </header>
      <main className="content" id="main-content" tabIndex={-1}><div key={location.pathname} className="page-motion">{children}</div></main>
    </div>
  </div>;
}
