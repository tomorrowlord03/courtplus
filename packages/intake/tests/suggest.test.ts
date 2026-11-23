import type { Entity } from '@courtplus/contracts';
import { describe, expect, it } from 'vitest';
import { chargedOffenceSuggestions, parseChargeSuggestion, suggestFields } from '../src/suggest.js';
import { normaliseOrderText } from '../src/normalise.js';

describe('suggestions for fictional orders', () => {
  it('reads a fictional header order date and operative grant', () => {
    const text = 'MCRC No. 12/2025\nFiction Alpha Versus State\nOrder On Board\n17.10.2025\n'
      + 'The accused was arrested on 01.09.2025. The application is allowed and the applicant shall be released on bail.';
    expect(suggestFields(text, [])).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'orderDate', value: '2025-10-17' }),
      expect.objectContaining({ field: 'bailOutcome', value: 'granted' }),
    ]));
  });

  it('reads fictional standalone Order and Date of Order header lines', () => {
    for (const label of ['Order', 'Date of Order:']) {
      const text = `Fictional Case No. 3/2025\n${label}\n05.04.2025\nThe subject appeared.`;
      expect(suggestFields(text, [])).toContainEqual(expect.objectContaining({ field: 'orderDate', value: '2025-04-05' }));
    }
  });

  it('reports rejected, withdrawn and mixed outcomes from fictional operative text', () => {
    expect(suggestFields('The bail application is rejected.', []).at(-1)).toEqual(expect.objectContaining({ field: 'bailOutcome', value: 'rejected' }));
    expect(suggestFields('The application is dismissed as withdrawn.', []).at(-1)).toEqual(expect.objectContaining({ field: 'bailOutcome', value: 'withdrawn' }));
    expect(suggestFields('The first bail application is allowed. The second bail application is rejected.', []).at(-1))
      .toEqual(expect.objectContaining({ field: 'bailOutcome', value: 'mixed' }));
  });

  it('collects a fictional full charge list and separates bail provisions', () => {
    const text = 'The accused faces offences under Sections 101, 103 and 115 of the BNS. '
      + 'Section 480 of the BNSS governs bail. Section 37 of the NDPS Act is a bail restriction.';
    const values = suggestFields(text, []).map(s => [s.field, s.value]);
    expect(values).toEqual(expect.arrayContaining([
      ['section', 'BNS 101'], ['section', 'BNS 103'], ['section', 'BNS 115'],
      ['citedProvision', 'BNSS 480'], ['citedProvision', 'NDPS 37'],
    ]));
    expect(chargedOffenceSuggestions(suggestFields(text, [])).map(s => s.value))
      .toEqual(['BNS 101', 'BNS 103', 'BNS 115']);
  });

  it('recognises fictional special Act charges and leaves common intention as cited law', () => {
    const text = 'The fictional FIR alleges Sections 66C and 66D of the Information Technology Act, '
      + 'Section 25(1-B)(a) of the Arms Act and Section 3(5) of the BNS.';
    expect(suggestFields(text, []).map(s => [s.field, s.value])).toEqual(expect.arrayContaining([
      ['section', 'OTHER 66C'], ['section', 'OTHER 66D'], ['section', 'ARMS 25(1-B)(a)'],
      ['citedProvision', 'BNS 3(5)'],
    ]));
  });

  it('starts the charge proposal after a cited bail provision', () => {
    const text = 'Section 483 of the BNSS governs this fictional bail application. '
      + 'The FIR alleges Sections 379 and 411 of the IPC. Section 37 of the NDPS Act is discussed.';
    expect(chargedOffenceSuggestions(suggestFields(text, [])).map(s => s.value)).toEqual(['IPC 379', 'IPC 411']);
  });
  it('pairs IPC, BNS and Hindi provisions with their acts and source sentences', () => {
    const text = 'Fictional matter concerns sections 379 and 411 IPC. Another example cites u/s 303(2) BNS.\n\f\nउदाहरण में भारतीय न्याय संहिता की धारा ३०३(२) है।';
    const charges = suggestFields(text, []).map(({ field, value, page, sentence }) => [field, value, page, sentence]);
    expect(charges).toEqual([
      ['section', 'IPC 379', 1, 'Fictional matter concerns sections 379 and 411 IPC.'],
      ['section', 'IPC 411', 1, 'Fictional matter concerns sections 379 and 411 IPC.'],
      ['section', 'BNS 303(2)', 1, 'Another example cites u/s 303(2) BNS.'],
      ['section', 'BNS 303(2)', 2, 'उदाहरण में भारतीय न्याय संहिता की धारा ३०३(२) है।'],
    ]);
  });

  it('pairs model-tagged provisions with a nearby model-tagged statute', () => {
    const text = 'The fictional Test Act governs clause 9A.';
    const entity = (label: Entity['label'], value: string): Entity => {
      const start = text.indexOf(value);
      return { label, text: value, start, end: start + value.length, score: 0.97 };
    };
    expect(suggestFields(text, [entity('STATUTE', 'Test Act'), entity('PROVISION', '9A')]))
      .toEqual([expect.objectContaining({ field: 'section', value: 'Test Act 9A', page: 1, sentence: text })]);
  });

  it('captures valid CNRs and applies date-role hints without guessing an invalid date', () => {
    const text = 'CNR No. XYZZ000000002026. Ignore XYZZ0000000020260.\n\f\n'
      + 'The fictional subject was arrested on 3/2/2025 and first remand was on 05.02.2025. '
      + 'Challan was filed on 6 March 2025. Bail was granted on 14-03-2025. Custody since 03-02-2025. '
      + 'गिरफ्तार १५.०३.२०२५। An invalid date is 31/02/2025.';
    const result = suggestFields(text, []);
    expect(result.map(({ field, value, page }) => [field, value, page])).toEqual([
      ['cnr', 'XYZZ000000002026', 1], ['arrestedOn', '2025-02-03', 2], ['firstRemandOn', '2025-02-05', 2],
      ['chargesheetOn', '2025-03-06', 2], ['bailGrantedOn', '2025-03-14', 2], ['custodySince', '2025-02-03', 2], ['arrestedOn', '2025-03-15', 2],
    ]);
    expect(result[0].sentence).toBe('CNR No. [CNR].');
  });

  it('uses the full-order masks in every suggestion while retaining case and CNR values', () => {
    const text = 'Fiction Alpha appeared in MCRC No. 12/2025, C.R.A. No. 33/2025, Crime No. 4/2025, '
      + 'FIR No. 9/2025 and CNR No. XYZZ000000002026; phone +91 60000-00000.\f'
      + 'Fiction Alpha was charged under section 379 IPC in 12/2025. '
      + 'The application in 9/2025 with phone 6000000000 is allowed.';
    const start = text.indexOf('12/2025');
    const entities: Entity[] = [
      { label: 'PETITIONER', text: 'Fiction Alpha', start: 0, end: 'Fiction Alpha'.length, score: 0.99 },
      { label: 'CASE_NUMBER', text: '12/2025', start, end: start + '12/2025'.length, score: 0.95 },
    ];
    const suggestions = suggestFields(text, entities);
    expect(suggestions).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'caseNo', value: '12/2025', entity: { ...entities[1], text: '[Case Number]' },
        sentence: 'Accused-1 appeared in [Case Number], [Case Number], [Case Number], FIR No. [FIR] and CNR No. [CNR]; phone [Phone].', page: 1 }),
      expect.objectContaining({ field: 'cnr', value: 'XYZZ000000002026' }),
      expect.objectContaining({ field: 'section', value: 'IPC 379', page: 2,
        sentence: 'Accused-1 was charged under section 379 IPC in [Case Number].' }),
      expect.objectContaining({ field: 'bailOutcome', value: 'granted', page: 2,
        sentence: 'application in [FIR] with phone [Phone] is allowed' }),
    ]));
    for (const { sentence } of suggestions) {
      expect(sentence).not.toMatch(/Fiction Alpha|(?:12|33|4|9)\/2025|XYZZ000000002026|60000/u);
    }
  });

  it('masks entity-only case numbers and overlapping court text in a fictional order', () => {
    const text = 'High Court of Example lists 123/2026 and phone 6000000000.';
    const start = text.indexOf('123/2026');
    const entities: Entity[] = [
      { label: 'COURT', text: text.slice(0, -1), start: 0, end: text.length - 1, score: 0.95 },
      { label: 'CASE_NUMBER', text: '123/2026', start, end: start + '123/2026'.length, score: 0.95 },
    ];
    expect(suggestFields(text, entities)).toEqual([
      expect.objectContaining({ field: 'court', value: 'High Court of Example lists [Case Number] and phone [Phone]',
        entity: { ...entities[0], text: 'High Court of Example lists [Case Number] and phone [Phone]' } }),
      expect.objectContaining({ field: 'caseNo', value: '123/2026',
        entity: { ...entities[1], text: '[Case Number]' } }),
    ]);
  });

  it('extracts case number, court and police station from a fictional header', () => {
    const result = suggestFields('IN THE HIGH COURT OF EXAMPLE\nCase No. 42 of 2025\nCrime No. 7/2025\nPolice Station: Fictional East, District Example.', []);
    expect(result.map(({ field, value }) => [field, value])).toEqual([
      ['court', 'HIGH COURT OF EXAMPLE'], ['caseNo', '42 of 2025'], ['caseNo', '7/2025'], ['policeStation', 'Fictional East'],
    ]);
  });

  it('repairs broken PDF words without losing page boundaries', () => {
    expect(normaliseOrderText('charge-\nsheet filed\n later\fSection 20(B)'))
      .toBe('chargesheet filed later\fSection 20(B)');
  });

  it('relates every number in a charge group to the same act', () => {
    const text = 'Fictional charges under section 379 IPC and sections 303(2), 304 BNS.';
    expect(suggestFields(text, []).map(s => s.value)).toEqual(['IPC 379', 'BNS 303(2)', 'BNS 304']);
  });

  it('normalises NDPS subsections and treats a reasoning bar as cited law', () => {
    const text = 'The fictional FIR alleges Section 20(B) of the Narcotic Drugs and Psychotropic Substances Act, 1985. '
      + 'Section 37 of the NDPS Act is a bar considered during bail reasoning.';
    expect(suggestFields(text, []).map(({ field, value }) => [field, value])).toEqual([
      ['section', 'NDPS 20(b)'], ['citedProvision', 'NDPS 37'],
    ]);
    expect(parseChargeSuggestion('NDPS 20(b)')).toEqual({ act: 'NDPS', section: '20', subsection: 'b' });
    expect(parseChargeSuggestion('NDPS 37')).toEqual({ act: 'NDPS', section: '37' });
    expect(parseChargeSuggestion('NDPS 20(b)(II)')).toEqual({ act: 'NDPS', section: '20', subsection: 'b', variant: 'ii' });
    expect(parseChargeSuggestion('BNSS 483')).toBeUndefined();
  });

  it('keeps each date with its nearest cue and leaves an ambiguous date unassigned', () => {
    const text = 'The fictional subject was arrested on 02.01.2025; final report was filed on 18.02.2025. '
      + 'On 03.03.2025, arrest and remand were both recorded. '
      + 'Bail was granted on 30th June 2026. हिरासत के बाद १५ मार्च २०२६ को जमानत मंजूर हुई।';
    expect(suggestFields(text, []).filter(s => /date|On|Granted|arrestedOn|chargesheetOn|bailGrantedOn/iu.test(s.field))
      .map(({ field, value }) => [field, value])).toEqual([
      ['arrestedOn', '2025-01-02'], ['chargesheetOn', '2025-02-18'], ['date', '2025-03-03'],
      ['bailGrantedOn', '2026-06-30'], ['bailGrantedOn', '2026-03-15'],
    ]);
  });
});
