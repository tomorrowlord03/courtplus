export const languageKey = 'courtplus.uiLanguage';

export type UiLanguage = 'en' | 'hi';

export const UI_LANGUAGES: ReadonlyArray<readonly [UiLanguage, string]> = [
  ['en', 'English'],
  ['hi', 'हिन्दी'],
];

export function readPreference(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

export function writePreference(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* The current window still uses the selection. */ }
}

