export * from './types.js';
export { normaliseText, tokenise, tokenMatches } from './normalise.js';
export { matchGuides } from './matcher.js';
export { BUILTIN_GUIDES } from './builtin-guides.js';

import type { Guide } from './types.js';
import { BUILTIN_GUIDES } from './builtin-guides.js';

/**
 * Retrieves a guide by its unique string identifier.
 */
export function getGuideById(id: string, guides: Guide[] = BUILTIN_GUIDES): Guide | undefined {
  return guides.find((g) => g.id === id);
}

/**
 * Returns all available topic ids.
 */
export function getAllGuideIds(guides: Guide[] = BUILTIN_GUIDES): string[] {
  return guides.map((g) => g.id);
}
