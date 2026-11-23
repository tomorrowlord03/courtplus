import { useEffect, useState } from 'react';

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

let strings: Translation = translations['en'] ?? {};

/** Look up a UI string; falls back to the English default, then the key. */
export function t(key: string, fallback?: string): string {
  const value = strings[key];
  return typeof value === 'string' ? value : fallback ?? key;
}

/** Loads data/i18n/<lang>.json if present. Missing file is fine. */
export async function loadLang(lang: string): Promise<void> {
  if (translations[lang]) {
    strings = translations[lang];
    return;
  }
  try {
    const res = await fetch(`./data/i18n/${lang}.json`);
    if (!res.ok) throw new Error('missing');
    strings = (await res.json()) as Translation;
  } catch {
    strings = {};
  }
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
  const [lang, setLang] = useState('en');
  const [, bump] = useState(0);
  useEffect(() => {
    void loadLang(lang).then(() => bump((n) => n + 1));
  }, [lang]);
  return [lang, setLang];
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
