import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import { Theme } from '@radix-ui/themes';
import { Toaster } from 'sonner';
import { localeFor, normalizePreferences, PREFERENCES_KEY, resolveAppearance, translate, type Language, type ProviderView, type ThemeMode } from './preferences-core.ts';
const defaults = { language: 'en' as Language, theme: 'system' as ThemeMode, providerView: 'cards' as ProviderView, locale: 'en-US', appearance: 'dark' as 'dark' | 'light', setLanguage: (_: Language) => {}, setTheme: (_: ThemeMode) => {}, setProviderView: (_: ProviderView) => {}, t: (s: string, values?: Record<string,string|number>) => translate("en",s,values) };
const PreferencesContext = createContext(defaults);
export const usePreferences = () => useContext(PreferencesContext);
export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState(() => {
    try { return normalizePreferences(JSON.parse(localStorage.getItem(PREFERENCES_KEY) ?? '{}')); }
    catch { return normalizePreferences(null); }
  });
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
  const appearance = resolveAppearance(prefs.theme, systemDark);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const changed = () => setSystemDark(mq.matches);
    mq.addEventListener('change', changed);
    return () => mq.removeEventListener('change', changed);
  }, []);
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = appearance;
    document.documentElement.lang = prefs.language;
    document.documentElement.classList.remove('dark', 'light');
    document.documentElement.classList.add(appearance);
    try { localStorage.setItem(PREFERENCES_KEY, JSON.stringify(prefs)); } catch { /* Private storage can be unavailable. */ }
  }, [appearance, prefs]);
  useEffect(() => {
    const changed = (event: StorageEvent) => {
      if (event.key === PREFERENCES_KEY) { try { setPrefs(normalizePreferences(JSON.parse(event.newValue ?? '{}'))); } catch {} }
    };
    window.addEventListener('storage', changed);
    return () => window.removeEventListener('storage', changed);
  }, []);
  const value = useMemo(() => ({ ...prefs, appearance, locale: localeFor(prefs.language),
    setLanguage: (language: Language) => setPrefs(p => ({ ...p, language })),
    setTheme: (theme: ThemeMode) => setPrefs(p => ({ ...p, theme })),
    setProviderView: (providerView: ProviderView) => setPrefs(p => ({ ...p, providerView })),
    t: (text: string, values?:Record<string,string|number>) => translate(prefs.language, text, values),
  }), [prefs, appearance]);
  return <PreferencesContext.Provider value={value}><Theme appearance={appearance} accentColor="indigo" grayColor="slate" panelBackground="solid" radius="medium"><>{children}<Toaster theme={appearance} position="bottom-right" toastOptions={{ style: { background: 'var(--panel-2)', color: 'var(--fg)', border: '1px solid var(--border)', fontFamily: 'var(--font-sans)' } }} /></></Theme></PreferencesContext.Provider>;
}
