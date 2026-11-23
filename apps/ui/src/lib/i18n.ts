import { useCallback, useEffect, useState } from 'react';
import hindi from '../../../../data/ui/hi.json';
import { languageKey, readPreference, writePreference, type UiLanguage } from './preferences';

type Translation = Record<string, unknown> & { _meta?: { reviewed?: boolean } };

// Eagerly import all translations at build time via Vite
const i18nModules = import.meta.glob<Translation>(
  '../../../../data/i18n/*.json',
  { eager: true, import: 'default' }
);

const translations: Record<string, Translation> = {};
for (const [path, mod] of Object.entries(i18nModules)) {
  const match = path.match(/([a-z]{2})\.json$/i);
  if (match) {
    translations[match[1].toLowerCase()] = mod;
  }
}

const hindiInterface: Readonly<Record<string, string>> = hindi;
let activeLanguage: UiLanguage = 'en';

/** Localizes interface copy. Case data and quoted source text bypass this function. */
export function ui(english: string, values?: Record<string, string | number>): string {
  const key = english.trim();
  const translation = activeLanguage === 'hi' && Object.hasOwn(hindiInterface, key) ? hindiInterface[key] : undefined;
  const message = translation === undefined ? english : english.replace(key, () => translation);
  return values ? message.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.hasOwn(values, name) ? String(values[name]) : match) : message;
}

/** Look up a UI string; falls back to the English default, then the key. */
export function t(key: string, fallback?: string): string {
  const value = translations[activeLanguage]?.[key] ?? translations.en?.[key];
  return typeof value === 'string' ? value : fallback === undefined ? key : ui(fallback);
}

/** Loads data/i18n/<lang>.json if present. Missing file is fine. */
export async function loadLang(lang: string): Promise<void> {
  activeLanguage = lang === 'hi' ? 'hi' : 'en';
}

/** Adds assets/fonts/fonts.css when it exists; ignored otherwise. */
export function loadFonts(): void {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = './assets/fonts/fonts.css';
  link.onerror = () => link.remove();
  document.head.appendChild(link);
}

export function useLang(): [string, (l: string) => void] {
  const [lang, setLang] = useState<UiLanguage>(() => readPreference(languageKey) === 'hi' ? 'hi' : 'en');
  activeLanguage = lang;
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  const change = useCallback((value: string) => {
    const next = value === 'hi' ? 'hi' : 'en';
    writePreference(languageKey, next);
    setLang(next);
  }, []);
  return [lang, change];
}

export function isReviewedLanguage(lang: string): boolean {
  return lang === 'en' || translations[lang]?._meta?.reviewed === true;
}

export const RIGHTS_CARD_LANGS: [string, string][] = [
  ['en', 'English'], ['hi', 'हिन्दी (Hindi)'], ['bn', 'বাংলা (Bengali)'], ['mr', 'मराठी (Marathi)'],
  ['ta', 'தமிழ் (Tamil)'], ['te', 'తెలుగు (Telugu)'], ['gu', 'ગુજરાતી (Gujarati)'], ['kn', 'ಕನ್ನಡ (Kannada)'],
  ['ml', 'മലയാളം (Malayalam)'], ['pa', 'ਪੰਜਾਬੀ (Punjabi)'], ['or', 'ଓଡ଼ିଆ (Odia)'], ['as', 'অসমীয়া (Assamese)'],
  ['ur', 'اردو (Urdu)'],
];
export const DRAFT_LANGS = RIGHTS_CARD_LANGS.filter(([lang]) =>
  (lang === 'en' || lang === 'hi') && isReviewedLanguage(lang),
);
