import { useSyncExternalStore } from 'react';
import { RESEARCH_INSTALLING, type CaseRecord, type PrecedentHit, type ResearchApi } from '@courtplus/contracts';

declare global {
  interface Window { courtplusResearch?: ResearchApi }
}

const desktopOnly = 'Precedent search runs in the Court+ desktop app.';

/** The desktop research bridge, or a stand-in that says research is unavailable here. */
export function researchApi(): ResearchApi {
  if (typeof window !== 'undefined' && window.courtplusResearch) return window.courtplusResearch;
  const none = { available: false as const, reason: desktopOnly };
  return {
    status: async () => ({ ...none, features: { search: false, sections: false, roles: false, fullText: false } }),
    searchPrecedents: async () => none,
    openPrecedent: async () => null,
    suggestSections: async () => none,
    classifyRoles: async () => none,
    logHint: async () => undefined,
  };
}

/** UI wording for an unavailable result: the install message stays exact so people recognise it. */
export function unavailableText(reason: string): string {
  return reason === RESEARCH_INSTALLING ? `${RESEARCH_INSTALLING}. Other tools keep working.` : reason;
}

const STOP = new Set(['the', 'and', 'for', 'with', 'of', 'in', 'on', 'to', 'a', 'an', 'is', 'was', 'by', 'or', 'under', 'section', 's']);

/** Words from the query worth highlighting (2+ characters, no stop words, numbers kept). */
export function queryTerms(query: string): string[] {
  const words = query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  return [...new Set(words.filter(word => (word.length > 1 || /\d/.test(word)) && !STOP.has(word)))];
}

export interface Segment { text: string; match: boolean }

/** Splits text into plain and matched parts, case-insensitively, on word starts. */
export function highlight(text: string, query: string): Segment[] {
  const terms = queryTerms(query).sort((a, b) => b.length - a.length);
  if (!terms.length || !text) return [{ text, match: false }];
  const escaped = terms.map(term => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])(${escaped.join('|')})`, 'giu');
  const segments: Segment[] = [];
  let last = 0;
  for (const found of text.matchAll(pattern)) {
    const start = found.index ?? 0;
    if (start > last) segments.push({ text: text.slice(last, start), match: false });
    segments.push({ text: found[0], match: true });
    last = start + found[0].length;
  }
  if (last < text.length) segments.push({ text: text.slice(last), match: false });
  return segments;
}

/** One-line citation for copying into a draft. */
export function formatCitation(hit: Pick<PrecedentHit, 'title' | 'citation' | 'court' | 'year' | 'url'>): string {
  const parts = [hit.title, hit.citation !== hit.title ? hit.citation : '', hit.court, hit.year ? String(hit.year) : '']
    .filter(Boolean);
  return parts.join(', ') + (hit.url ? ` (${hit.url})` : '');
}

/** Sentences for case-structure hints; keeps Hindi danda as a sentence end. */
export function splitSentences(text: string): string[] {
  return text.split(/(?<=[.?!।])\s+|\n+/).map(sentence => sentence.trim()).filter(sentence => sentence.length > 2).slice(0, 400);
}

/** Starting text for case hints, built only from the confirmed case facts. */
export function caseHintText(record: CaseRecord): string {
  const charges = record.charges.map(charge => `${charge.act} ${charge.section}${charge.subsection ? `(${charge.subsection})` : ''}`);
  const notes = record.events.map(event => event.note?.trim()).filter(Boolean);
  return [
    charges.length ? `Charges: ${charges.join(', ')}.` : '',
    record.court ? `Court: ${record.court}.` : '',
    ...notes.map(note => /[.?!।]$/.test(note!) ? note : `${note}.`),
  ].filter(Boolean).join('\n');
}

// Citations the user added for a draft. Per computer; a convenience list, not a record.
const draftKey = 'courtplus.draftCitations';
const listeners = new Set<() => void>();
let citations: string[] = readCitations();

function readCitations(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(draftKey) ?? '[]');
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  } catch { return []; }
}

function writeCitations(next: string[]) {
  citations = next;
  try { localStorage.setItem(draftKey, JSON.stringify(next)); } catch { /* Storage may be disabled. */ }
  listeners.forEach(listener => listener());
}

export function addDraftCitation(citation: string): boolean {
  if (citations.includes(citation)) return false;
  writeCitations([...citations, citation]);
  return true;
}

export function removeDraftCitation(citation: string): void {
  writeCitations(citations.filter(item => item !== citation));
}

export function useDraftCitations(): string[] {
  return useSyncExternalStore(listener => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, () => citations, () => citations);
}

export async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch { return false; }
}
