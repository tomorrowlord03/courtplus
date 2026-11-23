import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packaged = new URL('./resources/', import.meta.url);
export const resourceRoot = fileURLToPath(
  existsSync(new URL('templates/layout.html', packaged)) ? packaged : new URL('../../../', import.meta.url),
);

export interface RenderOptions {
  /** Directory containing data/i18n and assets/fonts. */
  localizationRoot?: string;
}

export function readOptional(path: string): Buffer | undefined {
  try {
    return readFileSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

const fonts = {
  en: 'Noto Sans',
  hi: 'Noto Sans Devanagari',
  bn: 'Noto Sans Bengali',
  ta: 'Noto Sans Tamil',
  te: 'Noto Sans Telugu',
  mr: 'Noto Sans Devanagari',
  gu: 'Noto Sans Gujarati',
  kn: 'Noto Sans Kannada',
  ml: 'Noto Sans Malayalam',
  pa: 'Noto Sans Gurmukhi',
  or: 'Noto Sans Oriya',
  as: 'Noto Sans Bengali',
  ur: 'Noto Naskh Arabic',
} as const;

export type Language = keyof typeof fonts;
export const supportedLanguages: readonly Language[] = Object.freeze(Object.keys(fonts) as Language[]);

export function documentFont(lang: Language, root: string) {
  const family = fonts[lang];
  const directory = join(root, 'assets', 'fonts');
  const css = readOptional(join(directory, 'fonts.css'))?.toString('utf8') ?? '';
  const faces = css.match(/@font-face\s*\{[^{}]*\}/g) ?? [];
  const embedded: string[] = [];

  for (const face of faces) {
    const name = /font-family:\s*['"]([^'"]+)['"]/.exec(face)?.[1];
    if (name !== family && name !== fonts.en) continue;
    // Copy only the declarations and local font files needed for this document.
    const properties = [];
    for (const property of ['font-style', 'font-weight']) {
      const value = new RegExp(property + '\\s*:\\s*([a-z0-9 ]+);').exec(face)?.[1];
      if (value) properties.push(property + ':' + value);
    }
    const file = /src:\s*url\(\s*['"]?(?:\.\/)?([\w/-]+(?:\.[\w-]+)*\.(ttf|woff2))['"]?\s*\)/.exec(face);
    if (!file || file[1].startsWith('/')) continue;
    const data = readOptional(join(directory, file[1]));
    if (data) {
      properties.push("font-family:'" + name + "'");
      properties.push('src:url(data:font/' + file[2] + ';base64,' + data.toString('base64') + ')');
      embedded.push('@font-face{' + properties.join(';') + '}');
    }
  }
  return { family: "'" + family + "'", css: embedded.join('\n') };
}
