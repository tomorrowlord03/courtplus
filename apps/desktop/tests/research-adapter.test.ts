import { describe, expect, it, vi } from 'vitest';
import type { HintDecision } from '@courtplus/contracts';
import {
  asRows, createResearchHints as createResearchAdapter, filterHits, RESEARCH_MISSING, toHit, toSection, type ResearchModule,
} from '../src/handlers/research-adapter';

const resourceDirectory = 'fictional-resources';

// Fictional corpus rows in the shapes the research package may return.
const rows = [
  { id: 'fx-1', title: 'Fictional State v. Sample Accused', citation: 'FICTIONAL/SC/2021/1', date: '2021-03-04',
    court: 'Supreme Court of India', snippet: 'Sample text about anticipatory bail and liberty.', score: 0.91, url: 'https://example.test/fx-1' },
  { docId: 'fx-2', title: 'Sample Petitioner v. Fictional Union', caseNumber: 'FICTIONAL WPC 2/2025', year: 2025,
    court: 'High Court of Chhattisgarh', text: 'Sample text on default bail.', score: '0.7' },
];

describe('research adapter without the package', () => {
  it('reports "being installed" instead of failing', async () => {
    const adapter = createResearchAdapter({ resourceDirectory, audit: vi.fn(), load: async () => undefined });
    expect(await adapter.status()).toMatchObject({ available: false, reason: RESEARCH_MISSING });
    expect(await adapter.searchPrecedents({ query: 'bail' })).toEqual({ available: false, reason: RESEARCH_MISSING });
    expect(await adapter.suggestSections('fictional facts')).toEqual({ available: false, reason: RESEARCH_MISSING });
    expect(await adapter.classifyRoles(['One sentence.'])).toEqual({ available: false, reason: RESEARCH_MISSING });
    expect(await adapter.openPrecedent('fx-1')).toBeNull();
  });

  it('treats a loader error or a missing model folder as not installed yet', async () => {
    const broken = createResearchAdapter({ resourceDirectory, audit: vi.fn(), load: async () => { throw new Error('boom'); } });
    expect((await broken.status()).available).toBe(false);
    const noModel = createResearchAdapter({ resourceDirectory, audit: vi.fn(),
      load: async () => ({ searchPrecedents: () => { throw new Error('ENOENT: model.onnx'); } }) });
    expect(await noModel.searchPrecedents({ query: 'bail' })).toEqual({ available: false, reason: RESEARCH_MISSING });
  });

  it('picks the package up once it appears', async () => {
    let installed: ResearchModule | undefined;
    const adapter = createResearchAdapter({ resourceDirectory, audit: vi.fn(), load: async () => installed });
    expect((await adapter.status()).available).toBe(false);
    installed = { searchPrecedents: async () => rows };
    expect(await adapter.status()).toMatchObject({ available: true, features: { search: true, sections: false } });
  });
});

describe('research adapter with the package', () => {
  const searchPrecedents = vi.fn(async (_query: unknown, _k: unknown) => ({ results: rows }));
  const createResearch = vi.fn((_options: unknown) => ({ searchPrecedents }));
  const module: ResearchModule = {
    createResearch,
    searchPrecedents: async () => { throw new Error('default model folder should not be used'); },
    suggestSections: async () => [
      { statute: 'IPC 379', score: 0.8, bnsEquivalent: 'BNS 303(2)' },
      { act: 'IPC', section: '411', score: 0.4 },
      { nonsense: true },
    ],
    classifyRoles: async (sentences: unknown) => (sentences as string[]).map((_, index) => ({ role: index ? 'ratio' : 'facts', score: 0.6 })),
    getPrecedent: async () => ({ ...rows[0], text: 'Full fictional judgment text.' }),
  };
  const audit = vi.fn();
  const adapter = createResearchAdapter({ resourceDirectory, audit, load: async () => module });

  it('creates the research functions on the model folder and maps hits with sources and the hint flag', async () => {
    const result = await adapter.searchPrecedents({ query: 'anticipatory bail', k: 5 });
    expect(createResearch).toHaveBeenCalledWith({ modelDir: expect.stringMatching(/fictional-resources[\\/]models[\\/]oldcases$/) });
    expect(searchPrecedents).toHaveBeenLastCalledWith('anticipatory bail', 5);
    expect(result.available && result.items).toEqual([
      expect.objectContaining({ id: 'fx-1', citation: 'FICTIONAL/SC/2021/1', year: 2021, hint: true, url: 'https://example.test/fx-1' }),
      expect.objectContaining({ id: 'fx-2', citation: 'FICTIONAL WPC 2/2025', year: 2025, snippet: 'Sample text on default bail.', score: 0.7 }),
    ]);
  });

  it('filters by court and year, asking the index for more when filtering', async () => {
    const result = await adapter.searchPrecedents({ query: 'bail', k: 3, court: 'chhattisgarh', yearFrom: 2024 });
    expect(searchPrecedents).toHaveBeenLastCalledWith('bail', 15);
    expect(result.available && result.items.map(hit => hit.id)).toEqual(['fx-2']);
  });

  it('maps section hints with the BNS mapping or an explicit "not mapped" note', async () => {
    const result = await adapter.suggestSections('fictional facts of a theft');
    expect(result.available && result.items).toEqual([
      expect.objectContaining({ act: 'IPC', section: '379', bnsEquivalent: 'BNS 303(2)', hint: true }),
      expect.objectContaining({ act: 'IPC', section: '411', bnsNote: 'BNS equivalent not mapped' }),
    ]);
  });

  it('keeps each sentence with its role', async () => {
    const result = await adapter.classifyRoles(['Sample facts.', 'Sample reasoning.']);
    expect(result.available && result.items.map(item => [item.sentence, item.role])).toEqual([
      ['Sample facts.', 'facts'], ['Sample reasoning.', 'ratio'],
    ]);
  });

  it('opens full text when the package ships it', async () => {
    expect(await adapter.openPrecedent('fx-1')).toMatchObject({ id: 'fx-1', text: 'Full fictional judgment text.' });
  });

  it('logs every accept or dismiss to the audit chain', async () => {
    const decision: HintDecision = { caseId: 'fictional-case', kind: 'section', hintId: 'section:IPC 379',
      label: 'IPC 379', source: 'fictional', decision: 'dismissed' };
    await adapter.logHint(decision);
    expect(audit).toHaveBeenCalledWith('research.hint', decision);
  });
});

describe('shapes returned by packages/research', () => {
  // Fictional values in the field layout of PrecedentHint, SectionSuggestion and RoleHint.
  const adapter = createResearchAdapter({ resourceDirectory, audit: vi.fn(), load: async () => ({
    searchPrecedents: async () => [{ id: 'sc:fx-9', title: 'Fictional v. Sample', citation: '', caseNumber: 'FICTIONAL CRA 9/2024',
      year: 2024, date: '2024-05-01', court: 'Supreme Court of India', judges: 'Fictional J.', excerpt: 'Sample excerpt on bail.',
      source: 'https://example.test/judgment/fx-9', score: 0.5, lexicalScore: 1, denseScore: 0.3, hint: true, hintLabel: 'Hint - the judge decides' }],
    suggestSections: async () => [
      { act: 'IPC', label: 'IPC 379', section: '379', title: 'Punishment for theft', source: 'Fictional statute table',
        bns: [{ section: '303(2)', source: 'Fictional crosswalk', page: '1', note: '' }], score: 0.9, aboveThreshold: true },
      { act: 'IPC', label: 'IPC 120B', section: '120B', title: 'Criminal conspiracy', source: 'Fictional statute table',
        bns: [], mappingNote: 'BNS equivalent not mapped', score: 0.7, aboveThreshold: true },
      { act: 'IPC', label: 'IPC 34', section: '34', title: 'Common intention', source: 'x', bns: [], score: 0.1, aboveThreshold: false },
    ],
    classifyRoles: async () => [{ index: 0, text: 'Sample facts.', role: 'Facts', score: 0.8, source: 'Fictional RR model' }],
  }) });

  it('uses the official URL from `source` and the excerpt as snippet', async () => {
    const result = await adapter.searchPrecedents({ query: 'bail' });
    expect(result.available && result.items[0]).toMatchObject({
      citation: 'FICTIONAL CRA 9/2024', url: 'https://example.test/judgment/fx-9', snippet: 'Sample excerpt on bail.',
      source: 'Court+ precedent index (published judgments)', year: 2024,
    });
  });

  it('keeps sections above the tuned threshold with their BNS mapping', async () => {
    const result = await adapter.suggestSections('fictional facts');
    expect(result.available && result.items).toEqual([
      expect.objectContaining({ act: 'IPC', section: '379', label: 'Punishment for theft', bnsEquivalent: '303(2)', source: 'Fictional statute table' }),
      expect.objectContaining({ section: '120B', bnsNote: 'BNS equivalent not mapped' }),
    ]);
  });

  it('reads role text and opens the official copy when no local text exists', async () => {
    const roles = await adapter.classifyRoles(['Sample facts.']);
    expect(roles.available && roles.items[0]).toMatchObject({ sentence: 'Sample facts.', role: 'Facts' });
    expect(await adapter.openPrecedent('sc:fx-9')).toMatchObject({ id: 'sc:fx-9', text: undefined, url: 'https://example.test/judgment/fx-9' });
    expect(await adapter.openPrecedent('never-seen')).toBeNull();
  });
});

// Opt-in: COURTPLUS_OLDCASES_MODELS=E:\AI-cache\courtplus-ml\oldcases runs the installed package and models.
describe.skipIf(!process.env.COURTPLUS_OLDCASES_MODELS)('installed research package and models', () => {
  const audit = vi.fn();
  const adapter = createResearchAdapter({ resourceDirectory, audit });
  const facts = 'The accused was found in possession of a stolen motorcycle belonging to the complainant. '
    + 'The police registered a case of theft and recovered the vehicle. The accused has been in custody since arrest.';

  it('is available and returns sourced hints', { timeout: 300_000 }, async () => {
    expect(await adapter.status()).toMatchObject({ available: true, features: { search: true, sections: true, roles: true } });
    const precedents = await adapter.searchPrecedents({ query: 'bail theft recovery of stolen property', k: 5 });
    expect(precedents.available && precedents.items.length).toBeGreaterThan(0);
    if (precedents.available) for (const hit of precedents.items) {
      expect(hit).toMatchObject({ hint: true, citation: expect.any(String), court: expect.any(String) });
      expect(hit.url ?? '').toMatch(/^(https:\/\/|$)/);
    }
    const sections = await adapter.suggestSections(facts);
    expect(sections.available).toBe(true);
    if (sections.available) for (const hint of sections.items) {
      expect(hint).toMatchObject({ act: 'IPC', hint: true, source: expect.any(String) });
      expect(hint.bnsEquivalent ?? hint.bnsNote).toBeTruthy();
    }
    const roles = await adapter.classifyRoles(['The accused was arrested on the same day.', 'The appeal is dismissed.']);
    expect(roles.available && roles.items.map(item => item.sentence)).toEqual(['The accused was arrested on the same day.', 'The appeal is dismissed.']);
  });
});

describe('mapping helpers', () => {
  it('reads long statute names', () => {
    expect(toSection({ statute: 'Section 302 in The Indian Penal Code, 1860' })).toMatchObject({ act: 'IPC', section: '302' });
  });
  it('unwraps common result envelopes', () => {
    expect(asRows({ hits: [{ a: 1 }] })).toEqual([{ a: 1 }]);
    expect(asRows('nope')).toEqual([]);
  });
  it('drops hits without a year when a year filter is set', () => {
    const hit = toHit({ title: 'Fictional undated' }, 0);
    expect(filterHits([hit], { query: 'x' })).toHaveLength(1);
    expect(filterHits([hit], { query: 'x', yearTo: 2020 })).toHaveLength(0);
  });
});
