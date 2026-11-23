import type { Entity } from '@courtplus/contracts';
import { expect, it } from 'vitest';
import { anonymise } from '../src/anonymise.js';

it('masks fictional names consistently, plus contact, address, relative and optional identifier spans', () => {
  const text = 'Fiction Alpha s/o Trial Parent, r/o 7 Sample Road\n\n+91 60000-00000. '
    + 'Witness Sample saw FICTION ALPHA. Fiction Alpha appeared before Test Judge.\n'
    + 'पिता परीक्षण पिता। CNR No. XYZZ000000002026; FIR No. 99990/2026.';
  const entity = (label: Entity['label'], name: string): Entity => {
    const start = text.indexOf(name);
    return { label, text: name, start, end: start + name.length, score: 0.99 };
  };
  const entities = [entity('PETITIONER', 'Fiction Alpha'), entity('WITNESS', 'Witness Sample'), entity('JUDGE', 'Test Judge'),
    entity('PETITIONER', 'FICTION ALPHA'), { ...entity('PETITIONER', 'Fiction Alpha'), start: text.lastIndexOf('Fiction Alpha'), end: text.lastIndexOf('Fiction Alpha') + 'Fiction Alpha'.length }];
  const masked = anonymise(text, entities, { maskIds: true });
  expect(masked.text).toBe('Accused-1 s/o [Relative], r/o [Address]\n\n[Phone]. '
    + 'Witness-1 saw Accused-1. Accused-1 appeared before Judge-1.\n'
    + 'पिता [Relative]। CNR No. [CNR]; FIR No. [FIR].');
  expect(masked.mapping.get('Fiction Alpha')).toBe('Accused-1');
  expect(masked.mapping.get('FICTION ALPHA')).toBe('Accused-1');
  const originalIds = anonymise(text, entities).text;
  expect(originalIds).toContain('XYZZ000000002026');
  expect(originalIds).toContain('99990/2026');
});

it('uses whole-word model offsets and merges touching names of the same role', () => {
  const text = 'Suraksha. Sur. AlphaBeta represented the fictional parties.';
  const span = (value: string, start: number): Entity => ({ label: 'LAWYER', text: value, start, end: start + value.length, score: 0.9 });
  const result = anonymise(text, [span('rak', 2), span('Sur', 10), span('Alpha', 15), span('Beta', 20)]);
  expect(result.text).toBe('Suraksha. Lawyer-1. Lawyer-2 represented the fictional parties.');
});

it('covers multiline party addresses through the party terminator', () => {
  const text = 'Example Person R/o Near Fiction Colony\nSample City P. S. Mock, District Imaginary\n... Applicant\nversus\nState';
  expect(anonymise(text, []).text).toBe('Example Person R/o [Address]\n... Applicant\nversus\nState');
});

it('stops a party address at the next numbered party', () => {
  const text = '1 - Fiction Person R/o Sample Lane\nDistrict Example\n2 - Another fictional party';
  expect(anonymise(text, []).text).toBe('1 - Fiction Person R/o [Address]\n2 - Another fictional party');
});

it('stops addresses at versus and masks Hindi resident blocks', () => {
  const text = 'Fiction Party resident of Example Lane, District Imaginary versus State\n'
    + 'काल्पनिक पक्ष निवासी नमूना नगर\n... Applicants';
  expect(anonymise(text, []).text).toBe('Fiction Party resident of [Address] versus State\n'
    + 'काल्पनिक पक्ष निवासी [Address]\n... Applicants');
});


it('keeps abbreviated addresses covered through the end of the address', () => {
  const text = 'Fictional person, resident of H. No. 123 Example Lane. The hearing ended.';
  expect(anonymise(text, []).text).toBe('Fictional person, resident of [Address]. The hearing ended.');
});
