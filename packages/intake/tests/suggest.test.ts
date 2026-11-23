import type { Entity } from '@courtplus/contracts';
import { describe, expect, it } from 'vitest';
import { parseChargeSuggestion, suggestFields } from '../src/suggest.js';
import { normaliseOrderText } from '../src/normalise.js';

describe('suggestions for fictional orders', () => {
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
    expect(result[0].sentence).toBe('CNR No. XYZZ000000002026.');
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
