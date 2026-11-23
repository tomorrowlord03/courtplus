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
  const originalIds = anonymise(text, entities, { maskIds: false }).text;
  expect(originalIds).toContain('XYZZ000000002026');
  expect(originalIds).toContain('99990/2026');
});

it('finds fictional party, relative, narrative, counsel and Hindi names without model entities', () => {
  const text = 'Fiction Alpha S/o Trial Parent, R/o Sample Lane\n... Applicant\n'
    + 'The accused Fiction Alpha met witness Sample Person. Advocate Counsel Example appeared. '
    + 'Sample Person spoke to Trial Parent. Hon\'ble Shri Justice Bench Example heard the case.\n'
    + 'काल्पनिक नाम पुत्र काल्पनिक पिता। काल्पनिक नाम फिर आया।';
  const result = anonymise(text, []);
  for (const name of ['Fiction Alpha', 'Trial Parent', 'Sample Person', 'Counsel Example', 'Bench Example', 'काल्पनिक नाम']) {
    expect(result.text).not.toContain(name);
  }
  expect(result.text).toContain('[Address]');
});

it('masks recurring fictional Hindi relatives named after kinship markers', () => {
  const text = 'कल्पना पात्र आत्मज नमूना पिता। नमूना पिता दोबारा आए।';
  expect(anonymise(text, []).text).not.toContain('नमूना पिता');
});

it('covers fictional daughter, wife, complainant, victim and deceased names without model help', () => {
  const text = 'Trial Daughter D/o Sample Mother. Trial Wife W/o Sample Partner. '
    + 'Complainant Example Speaker spoke. Victim Sample Survivor and deceased Example Person were mentioned. '
    + 'Sample Survivor spoke again. काल्पनिक पत्नी पत्नी नमूना।';
  const masked = anonymise(text, []).text;
  for (const name of ['Trial Daughter', 'Sample Mother', 'Trial Wife', 'Sample Partner', 'Example Speaker',
    'Sample Survivor', 'Example Person', 'काल्पनिक पत्नी']) expect(masked).not.toContain(name);
});

it('masks fictional case, crime, appeal, FIR and CNR identifiers by default', () => {
  const text = 'MCRC No. 12/2025 CRA 33/2025 Crime No. 4/2025 FIR No. 9/2025 CNR XYZZ000000002026';
  expect(anonymise(text, []).text).toBe('[Case Number] [Case Number] [Case Number] FIR No. [FIR] CNR [CNR]');
  expect(anonymise(text, [], { maskIds: false }).text).toBe(text);
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

it('masks an entire fictional alias chain and reuses its pseudonym for each spelling', () => {
  const text = '1 - Fiction Alpha @ Fable @ कल्पना पात्र S/o Trial Parent\n... Applicant\n'
    + 'FICTION ALPHA met someone. fable filed a note. कल्पना पात्र signed it.';
  const result = anonymise(text, []);
  expect(result.text).toBe('1 - Accused-1 S/o [Relative]\n... Applicant\n'
    + 'Accused-1 met someone. Accused-1 filed a note. Accused-1 signed it.');
  expect(result.mapping.get('Fable')).toBe('Accused-1');
  expect(result.mapping.get('कल्पना पात्र')).toBe('Accused-1');
});

it('masks fictional names across a soft line break and preserves paragraph and page boundaries', () => {
  const text = 'Fiction Alpha S/o Trial Parent\n... Applicant\n'
    + 'The statement of FICTION\n  alpha was filed. Fictional Alpha was a heading.\n'
    + 'Fiction\n\nAlpha appears in a new paragraph. Fiction\fAlpha starts a new page.';
  expect(anonymise(text, []).text).toBe('Accused-1 S/o [Relative]\n... Applicant\n'
    + 'The statement of Accused-1 was filed. Fictional Alpha was a heading.\n'
    + 'Fiction\n\nAlpha appears in a new paragraph. Fiction\fAlpha starts a new page.');
});

it('matches a fictional name found by the model across a line break against an inline repeat', () => {
  const name = 'Fiction\r\n Alpha';
  const text = `${name} appeared. fiction alpha filed a note.`;
  const entities: Entity[] = [{ label: 'PETITIONER', text: name, start: 0, end: name.length, score: 0.99 }];
  expect(anonymise(text, entities).text).toBe('Accused-1 appeared. Accused-1 filed a note.');
});

it('masks a fictional party name with a single extra letter after a narrative reference', () => {
  const text = 'Fiction Alpha S/o Trial Parent\n... Applicant\n'
    + 'The police seized the parcel from the possession of\nFiction Alppha. '
    + 'A label read Fiction Alppha. A statement of Fiction Alphyx followed.';
  expect(anonymise(text, []).text).toBe('Accused-1 S/o [Relative]\n... Applicant\n'
    + 'The police seized the parcel from the possession of\nAccused-1. '
    + 'A label read Fiction Alppha. A statement of Fiction Alphyx followed.');
});

it.each(['Late', 'x'])('masks a fictional relative after a malformed kinship marker (%s)', suffix => {
  const text = `Fiction Alpha S/o${suffix} Trial Alpha, aged about 30, R/o Sample Lane\n... Applicant\n`
    + 'The notation s/otherwise was quoted.';
  const entities: Entity[] = [{ label: 'PETITIONER', text: 'Fiction Alpha', start: 0, end: 'Fiction Alpha'.length, score: 0.99 }];
  expect(anonymise(text, entities).text).toBe('Accused-1 S/o [Relative], R/o [Address]\n... Applicant\n'
    + 'The notation s/otherwise was quoted.');
});
