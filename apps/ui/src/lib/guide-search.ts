import help from '../../../../data/guide/help.json';

export type Localized = { en: string; hi: string };
export type GuidePassage = { id: string; screenId: string; title: Localized; text: Localized };
export const passages: GuidePassage[] = help.passages;

const words = (value: string): string[] => value.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

/** Small, deterministic BM25 search over bundled text; works without a network. */
export function searchGuide(question: string, lang: string, items: GuidePassage[] = passages): GuidePassage[] {
  const terms = [...new Set(words(question))];
  if (!terms.length) return [];
  const docs = items.map(item => words(`${item.title[lang === 'hi' ? 'hi' : 'en']} ${item.text[lang === 'hi' ? 'hi' : 'en']} ${item.title.en} ${item.text.en}`));
  const avg = docs.reduce((sum, doc) => sum + doc.length, 0) / (docs.length || 1);
  const frequency = terms.map(term => docs.filter(doc => doc.includes(term)).length);
  return items.map((item, index) => {
    const doc = docs[index];
    const score = terms.reduce((sum, term, termIndex) => {
      const count = doc.filter(word => word === term).length;
      if (!count) return sum;
      const idf = Math.log(1 + (items.length - frequency[termIndex] + .5) / (frequency[termIndex] + .5));
      return sum + idf * count * 2.2 / (count + 1.2 * (.25 + .75 * doc.length / (avg || 1)));
    }, 0);
    return { item, score };
  }).filter(hit => hit.score > 0).sort((a, b) => b.score - a.score).slice(0, 3).map(hit => hit.item);
}
