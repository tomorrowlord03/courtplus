import type { Guide, MatchOptions, MatchResult } from './types.js';
import { normaliseText, tokenise, tokenMatches } from './normalise.js';
import { BUILTIN_GUIDES } from './builtin-guides.js';

/**
 * Matches a user description against the legal guides in English and Hindi.
 * Scores matches based on exact phrase occurrences, token overlaps, and morphological matches.
 * Returns up to `limit` (default: 3) top-ranked guides along with the matched keywords and score.
 */
export function matchGuides(
  query: string,
  guides: Guide[] = BUILTIN_GUIDES,
  options: MatchOptions = {}
): MatchResult[] {
  const limit = options.limit ?? 3;
  const minScore = options.minScore ?? 1;

  const normQuery = normaliseText(query);
  if (!normQuery) {
    return [];
  }

  const queryTokens = tokenise(normQuery);
  const queryTokenSet = new Set(queryTokens);

  const results: MatchResult[] = [];

  for (const guide of guides) {
    let score = 0;
    const matchedWordsSet = new Set<string>();

    const allKeywords = [
      ...guide.keywords_en.map((k) => ({ kw: k, lang: 'en' as const })),
      ...guide.keywords_hi.map((k) => ({ kw: k, lang: 'hi' as const })),
    ];

    for (const { kw } of allKeywords) {
      const normKw = normaliseText(kw);
      if (!normKw) continue;

      const kwTokens = tokenise(normKw);

      if (kwTokens.length > 1) {
        // Multi-word phrase check
        if (normQuery.includes(normKw)) {
          // Exact phrase match in the query
          score += 6 + kwTokens.length * 2;
          matchedWordsSet.add(kw);
        } else {
          // Check how many individual tokens of the multi-word keyword match the query
          let matchedTokensCount = 0;
          for (const kt of kwTokens) {
            let found = false;
            for (const qt of queryTokenSet) {
              if (tokenMatches(qt, kt)) {
                found = true;
                break;
              }
            }
            if (found) matchedTokensCount++;
          }

          // If at least 2 tokens match or all tokens match (e.g. in different order or interspersed)
          if (matchedTokensCount >= 2 || (kwTokens.length <= 2 && matchedTokensCount === kwTokens.length)) {
            score += matchedTokensCount * 2;
            matchedWordsSet.add(kw);
          }
        }
      } else {
        // Single-word keyword check
        const singleToken = kwTokens[0];
        let matched = false;

        for (const qt of queryTokenSet) {
          if (tokenMatches(qt, singleToken)) {
            matched = true;
            break;
          }
        }

        if (matched) {
          score += 3;
          matchedWordsSet.add(kw);
        }
      }
    }

    // Check title tokens for additional thematic boosting
    const titleEnTokens = tokenise(guide.title_en);
    const titleHiTokens = tokenise(guide.title_hi);
    for (const tt of [...titleEnTokens, ...titleHiTokens]) {
      if (tt.length >= 4 && queryTokenSet.has(tt)) {
        score += 1;
      }
    }

    if (score >= minScore) {
      results.push({
        guide,
        score,
        matchedWords: Array.from(matchedWordsSet),
      });
    }
  }

  // Sort descending by score; if tied, alphabetical by id for deterministic results
  results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.guide.id.localeCompare(b.guide.id);
  });

  return results.slice(0, limit);
}
