import hindiData from '../../../../../data/ui/hi.json';
import { languageKey, readPreference } from '../../lib/preferences';

const hindiDictionary: Readonly<Record<string, string>> = hindiData;

export function companionText(
  key: string,
  fallback: string,
  values?: Record<string, string | number>,
  activeLang?: string
): string {
  let lang = activeLang;
  if (!lang) {
    const pref = readPreference(languageKey);
    if (pref === 'hi') lang = 'hi';
    else if (typeof document !== 'undefined') {
      lang = document.documentElement.lang || 'en';
    } else {
      lang = 'en';
    }
  }

  let template = fallback;

  if (lang === 'hi') {
    if (Object.hasOwn(hindiDictionary, key)) {
      template = hindiDictionary[key];
    } else if (Object.hasOwn(hindiDictionary, fallback)) {
      template = hindiDictionary[fallback];
    }
  }

  if (!values) return template;

  return template.replace(/\{(\w+)\}/g, (match, paramName: string) => {
    return Object.hasOwn(values, paramName) ? String(values[paramName]) : match;
  });
}

export function useCompanionText() {
  return (key: string, fallback: string, values?: Record<string, string | number>) =>
    companionText(key, fallback, values);
}
