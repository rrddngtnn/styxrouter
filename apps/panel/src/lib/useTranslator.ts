import { usePreferences } from './preferences.tsx';
export function useTranslator() { return usePreferences().t; }
