import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { en, it, SUPPORTED_LANGUAGES, type TranslationKey, type UILanguage } from './translations';
import { STORAGE_KEYS, getStorageString, setStorageString } from '../utils/storage';

interface LanguageContextValue {
  language: UILanguage;
  setLanguage: (lang: UILanguage) => void;
  toggleLanguage: () => void;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

function detectInitialLanguage(): UILanguage {
  const stored = getStorageString(STORAGE_KEYS.LANGUAGE, '');
  if (stored === 'it' || stored === 'en') return stored;
  if (typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('it')) {
    return 'it';
  }
  return 'it';
}

function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  let result = template;
  for (const [key, value] of Object.entries(params)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), String(value));
  }
  return result;
}

export function LanguageProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [language, setLanguageState] = useState<UILanguage>(detectInitialLanguage);

  useEffect(() => {
    setStorageString(STORAGE_KEYS.LANGUAGE, language);
    if (typeof document !== 'undefined') {
      document.documentElement.lang = language;
    }
  }, [language]);

  const setLanguage = useCallback((lang: UILanguage) => {
    setLanguageState(lang);
  }, []);

  const toggleLanguage = useCallback(() => {
    setLanguageState((prev) => (prev === 'en' ? 'it' : 'en'));
  }, []);

  const t = useCallback(
    (key: TranslationKey, params?: Record<string, string | number>): string => {
      const dict = language === 'it' ? it : en;
      const fallback = en[key] ?? (key as string);
      const template = dict[key] ?? fallback;
      return interpolate(template, params);
    },
    [language]
  );

  const value = useMemo<LanguageContextValue>(
    () => ({ language, setLanguage, toggleLanguage, t }),
    [language, setLanguage, toggleLanguage, t]
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

// Fallback context when no provider is mounted — useful for unit tests
// and rare error-boundary fallbacks. Always returns English literals.
const fallbackContext: LanguageContextValue = {
  language: 'en',
  setLanguage: () => {},
  toggleLanguage: () => {},
  t: (key, params) => interpolate(en[key] ?? key, params),
};

export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  return ctx ?? fallbackContext;
}

export function useTranslation(): {
  t: LanguageContextValue['t'];
  language: UILanguage;
} {
  const { t, language } = useLanguage();
  return { t, language };
}

export { SUPPORTED_LANGUAGES };
export type { UILanguage, TranslationKey };
