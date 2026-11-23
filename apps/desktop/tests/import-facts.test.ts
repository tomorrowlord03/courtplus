import type { FieldSuggestion, Person } from '@courtplus/contracts';
import * as engine from '@courtplus/engine';
import { describe, expect, it } from 'vitest';
import { buildBoard } from '../src/handlers/board';
import { applySuggestion, buildCaseRecord, suggestionTarget, type CaseInput } from '../ui/import-facts';

const suggestion = (field: string, value: string): FieldSuggestion => ({
  field, value, sentence: 'Fictional sentence about ' + field + '.', page: 1, confidence: 0.8,
});
const input = (overrides: Partial<CaseInput> = {}): CaseInput => ({
  id: 'case-fictional', personId: 'person-fictional', docId: 'fictional-doc', confirmedBy: 'Fictional Officer (jail office)',
  confirmedAt: '2026-11-23T05:00:00.000Z', facts: { section: 'IPC 379' }, stage: 'FIR', pendingStatus: 'trial',
  ongoing: true, ...overrides,
});

describe('desktop import suggestions', () => {
  it('maps custody-since and arrest dates to judicial custody start', () => {
    expect(suggestionTarget(suggestion('custodySince', '2024-01-10'))).toBe('judicialStart');
    expect(suggestionTarget(suggestion('arrestedOn', '2024-01-09'))).toBe('judicialStart');
    expect(applySuggestion({}, suggestion('custodySince', '2024-01-10'))).toEqual({ judicialStart: '2024-01-10' });
  });

  it('maps bail suggestions to the bail fields and dates a granted outcome to the order', () => {
    expect(applySuggestion({}, suggestion('bailGrantedOn', '2025-03-14'))).toEqual({ bailGrantedOn: '2025-03-14' });
    expect(applySuggestion({ orderDate: '2025-03-14' }, suggestion('bailOutcome', 'granted')))
      .toEqual({ orderDate: '2025-03-14', bailOutcome: 'granted', bailGrantedOn: '2025-03-14' });
    expect(applySuggestion({ orderDate: '2025-03-14', bailGrantedOn: '2025-03-01' }, suggestion('bailOutcome', 'granted')).bailGrantedOn)
      .toBe('2025-03-01');
    // Mixed or withdrawn outcomes need a person to read the order; they are not offered as one click.
    expect(suggestionTarget(suggestion('bailOutcome', 'mixed'))).toBeUndefined();
    expect(suggestionTarget(suggestion('date', '2025-03-14'))).toBeUndefined();
  });

  it('appends charge suggestions on separate lines', () => {
    expect(applySuggestion({ section: 'IPC 379' }, suggestion('section', 'IPC 411')).section).toBe('IPC 379\nIPC 411');
  });
});

describe('desktop confirmed case record', () => {
  it('requires a confirmer and records them on every source', () => {
    expect(() => buildCaseRecord(input({ confirmedBy: '  ' }))).toThrow(/confirming/);
    const record = buildCaseRecord(input({ facts: { section: 'IPC 379', judicialStart: '2024-01-10', firstRemandOn: '2024-01-10' } }));
    const sources = [...record.charges, ...record.custody, ...record.events].map(item => item.source);
    expect(sources).toHaveLength(3);
    for (const source of sources) expect(source).toMatchObject({ docId: 'fictional-doc', verifiedBy: 'Fictional Officer (jail office)' });
  });

  it('turns a bail outcome into bail events', () => {
    const granted = buildCaseRecord(input({ facts: { section: 'IPC 379', orderDate: '2025-03-14', bailOutcome: 'granted' } }));
    expect(granted.bailGrantedOn).toBe('2025-03-14');
    expect(granted.events).toContainEqual(expect.objectContaining({ kind: 'bail_granted', on: '2025-03-14' }));
    const rejected = buildCaseRecord(input({ facts: { section: 'IPC 379', orderDate: '2025-03-14', bailOutcome: 'rejected' } }));
    expect(rejected.bailGrantedOn).toBeUndefined();
    expect(rejected.events).toEqual([expect.objectContaining({ kind: 'bail_rejected', on: '2025-03-14' })]);
    expect(() => buildCaseRecord(input({ facts: { section: 'IPC 379', bailOutcome: 'granted' } }))).toThrow(/bail grant date/);
  });

  it('puts an acquitted case with ongoing custody in the court and jail records disagree lane', () => {
    const person: Person = {
      id: 'person-fictional', alias: 'Accused-901', caseIds: ['case-fictional'],
      priorConviction: 'unknown', otherHolds: 'unknown', prisonerType: 'undertrial',
    };
    expect(() => buildCaseRecord(input({ otherEvent: { kind: 'acquitted' } }))).toThrow(/date of the acquitted/);
    const record = buildCaseRecord(input({
      facts: { section: 'IPC 379', judicialStart: '2024-01-10' }, otherEvent: { kind: 'acquitted', on: '2026-10-01' },
    }));
    expect(record.events).toContainEqual(expect.objectContaining({ kind: 'acquitted', on: '2026-10-01' }));
    const board = buildBoard(engine, [person], [record], '2026-11-23', new Map(), 10);
    expect(board.all).toContainEqual(expect.objectContaining({ caseId: 'case-fictional', lane: 'COURT_JAIL_MISMATCH' }));
  });
});
