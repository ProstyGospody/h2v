import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';
import { translations, type TranslationKey } from '@/shared/i18n/translations';

export type Locale = keyof typeof translations;
export type TranslationParams = Record<string, number | string>;
export type Translate = (key: TranslationKey, params?: TranslationParams) => string;

type I18nContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: Translate;
};

const DEFAULT_LOCALE: Locale = 'en';
const LOCALE_STORAGE_KEY = 'h2v.locale';
const supportedLocales = Object.keys(translations) as Locale[];

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: PropsWithChildren) {
  const [locale, setLocaleState] = useState<Locale>(() => initialLocale());

  const setLocale = useCallback((nextLocale: Locale) => {
    setLocaleState(nextLocale);
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
    try {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    } catch {
    }
  }, [locale]);

  const t = useCallback<Translate>(
    (key, params) => interpolate(translations[locale][key] ?? translations[DEFAULT_LOCALE][key], params),
    [locale],
  );

  const value = useMemo<I18nContextValue>(() => ({ locale, setLocale, t }), [locale, setLocale, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error('useI18n must be used within an I18nProvider');
  }
  return context;
}

export function getLocaleLabel(locale: Locale): TranslationKey {
  return locale === 'ru' ? 'language.russian' : 'language.english';
}

export function getSupportedLocales(): Locale[] {
  return supportedLocales;
}

function initialLocale(): Locale {
  if (typeof window === 'undefined') {
    return DEFAULT_LOCALE;
  }

  try {
    const saved = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    if (isLocale(saved)) {
      return saved;
    }
  } catch {
  }

  const browserLocales = window.navigator.languages?.length
    ? window.navigator.languages
    : [window.navigator.language];
  return browserLocales.some((value) => value.toLowerCase().startsWith('ru')) ? 'ru' : DEFAULT_LOCALE;
}

function isLocale(value: string | null): value is Locale {
  return supportedLocales.includes(value as Locale);
}

function interpolate(message: string, params?: TranslationParams): string {
  if (!params) return message;
  return message.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = params[key];
    return value === undefined ? match : String(value);
  });
}
