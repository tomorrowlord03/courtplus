/**
 * Normalises English and Hindi / Devanagari text for robust matching.
 */

// Devanagari danda, double danda, abbreviation sign, plus standard punctuation
const PUNCTUATION_REGEX = /[\u0964\u0965\u0970.,\/#!$%\^&\*;:{}=\-_`~()?"'’“”«»\[\]<>|\\+]/g;
const MULTI_SPACE_REGEX = /\s+/g;

/**
 * Normalises a text string:
 * - NFC Unicode normalization
 * - Lowercase for Latin characters
 * - Replaces punctuation and special symbols with spaces
 * - Collapses consecutive whitespace into a single space and trims
 */
export function normaliseText(text: string): string {
  if (!text) return '';
  return text
    .normalize('NFC')
    .toLowerCase()
    .replace(PUNCTUATION_REGEX, ' ')
    .replace(MULTI_SPACE_REGEX, ' ')
    .trim();
}

/**
 * Tokenises normalised text into unique words/tokens.
 */
export function tokenise(text: string): string[] {
  const norm = normaliseText(text);
  if (!norm) return [];
  return norm.split(' ').filter(Boolean);
}

/**
 * Checks if a token matches or is an inflected form of a keyword token.
 * E.g., 'accident' matches 'accidents', 'arrest' matches 'arrested',
 * 'cheque' matches 'cheques', 'किराया' matches 'किरायेदार'.
 */
export function tokenMatches(queryToken: string, keywordToken: string): boolean {
  if (queryToken === keywordToken) return true;
  if (keywordToken.length >= 4) {
    if (queryToken.startsWith(keywordToken) || keywordToken.startsWith(queryToken)) {
      // Allow 1-3 letter inflection difference
      const diff = Math.abs(queryToken.length - keywordToken.length);
      if (diff <= 3) return true;
    }
  }
  return false;
}
