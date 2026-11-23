import { expect, it } from 'vitest';
import { explain, lookupOffence, policeCustodyCheck } from '../src/index.js';
import type { EngineCaseRecord } from '../src/index.js';
import { alert, fact, fir, record, run, source } from './fixtures.js';

it.each([
  { pendingStatus: 'appeal' },
  { pendingStatus: 'disposed', events: [{ kind: 'convicted', on: '2025-03-01' }] }
] satisfies Partial<EngineCaseRecord>[])('uses another case as conviction and hold evidence ($pendingStatus)', other => {
  const result = run('2025-07-02', {}, {}, [record({ id: 'fictional-other', ...other })]);
  expect(result).toMatchObject({ status: 'NEEDS_LAWYER_REVIEW', thresholdFraction: '1/2' });
  expect(result.reasons).toContain('Another case records a conviction or appeal. Verify the current hold.');
  expect(result.nalsaCategories).not.toContain(2);
});

it('ignores future convictions and convictions on a different person’s record', () => {
  const result = run('2025-05-02', {}, {}, [
    record({ id: 'fictional-other', pendingStatus: 'disposed', events: [{ kind: 'convicted', on: '2025-05-03' }] }),
    record({ id: 'fictional-unrelated', personId: 'fictional-unrelated', pendingStatus: 'appeal' })
  ]);
  expect(result).toMatchObject({ status: 'APPLY_NOW', thresholdFraction: '1/3' });
});

it.each([
  { framedOn: undefined, source: undefined },
  { framedOn: '2025-04-01', source: { docId: 'fictional-order' } },
  { framedOn: '2025-04-01', source: { docId: '', page: 1 } },
  { framedOn: '2025-04-01', source: { docId: 'fictional-order', page: 0 } },
  { framedOn: '2025-02-29', source }
])('keeps the FIR when framing evidence is incomplete or invalid (%j)', fields => {
  const result = run('2025-05-02', {
    charges: [fir('302'), { ...fir(), stage: 'FRAMED', ...fields }]
  });
  expect(result.status).toBe('NEEDS_LAWYER_REVIEW');
  expect(result.reasons).toContain('Unverified framed charge requires lawyer review.');
  expect(result.trace.find(step => step.id === 'charges')?.inputs.charges).toEqual([
    expect.objectContaining({ section: '302', death: true })
  ]);
});

it.each([
  ['IPC', '451'], ['IPC', '392'], ['BNS', '309(4)'], ['BNS', '332(c)'], ['IPC', '457'], ['BNS', '331(4)']
] as const)('reviews %s %s when the aggravated limb is unresolved', (act, section) => {
  const result = run('2025-05-02', { charges: [fir(section, act)] });
  expect(result.status).toBe('NEEDS_LAWYER_REVIEW');
  expect(result.reasons).toContainEqual(expect.stringContaining('Specify the penalty variant for ' + act + ' s.' + section));
  expect(lookupOffence(act, section)).toBeNull();
});

it.each(['yes', 'unknown'] as const)('reviews possible repeat theft with prior conviction %s', priorConviction => {
  const result = run('2025-05-02', { charges: [fir('303(2)', 'BNS')] }, { priorConviction });
  expect(result.status).toBe('NEEDS_LAWYER_REVIEW');
  expect(result.reasons).toContain('Verify whether the repeat-conviction penalty applies to BNS s.303(2).');
  expect(result.maxTermDays).toBeUndefined();
});

it('uses the three-year theft penalty when there is no prior conviction', () => {
  expect(run('2025-05-02', { charges: [fir('303(2)', 'BNS')] }).maxTermDays).toBe(1095);
});

it('uses the explicitly recorded repeat-theft penalty', () => {
  const result = run('2025-05-02', { charges: [{ ...fir('303(2)', 'BNS'), variant: 'repeat' }] }, { priorConviction: 'yes' });
  expect(result).toMatchObject({ maxTermDays: 1826, thresholdFraction: '1/2' });
});

it.each([['IPC', '457'], ['BNS', '331(4)']] as const)('resolves both punishment limbs under %s %s', (act, section) => {
  const ordinary = run('2025-05-02', { charges: [{ ...fir(section, act), variant: 'ordinary' }] });
  const theft = run('2025-05-02', { charges: [{ ...fir(section, act), variant: 'theft' }] });
  expect(ordinary.maxTermDays).toBe(1826);
  expect(theft.maxTermDays).toBe(5113);
  expect(lookupOffence('IPC', '457', 'theft')?.bnsEquivalent).toBe('331(4)');
});

it('records the remaining house-breaking terms and the BNS equivalents for IPC 307 and 380', () => {
  expect(lookupOffence('BNS', '331(1)')?.maxText).toBe('2 years');
  expect(lookupOffence('BNS', '331(2)')?.maxText).toBe('3 years');
  expect(lookupOffence('BNS', '331(3)', '3theft')?.maxText).toBe('10 years');
  expect(lookupOffence('BNS', '331(5)')?.maxText).toBe('10 years');
  expect(lookupOffence('IPC', '307', 'life_convict_hurt')?.bnsEquivalent).toBe('109(2)');
  expect(lookupOffence('IPC', '380')?.bnsEquivalent).toBe('305(a)');
  expect(lookupOffence('BNS', '305(a)')?.maxText).toBe('7 years');
});

it('flags a fine-only penalty when a verified roster establishes current custody with no dated spell', () => {
  const result = run('2025-05-02', { charges: [fir('283')], custody: [] }, { evidence: { jailRoster: fact('yes') } });
  expect(result).toMatchObject({ maxTermDays: 0, ceilingUrgent: true, status: 'NEEDS_LAWYER_REVIEW' });
  expect(result.reasons).toContain('Custody is recorded for an offence with no custodial maximum.');
});

it('flags the absolute custody ceiling independently of accused delay and shows both board lanes', () => {
  const result = run('2025-12-31', {
    custody: [...record().custody, { kind: 'accused_delay', start: '2025-02-01', end: '2025-03-01', source }]
  });
  expect(result).toMatchObject({ status: 'APPLY_NOW', rawCustodyDays: 365, countedCustodyDays: 337, ceilingUrgent: true });
  expect(result.reasons).toContain('CEILING_URGENT_REVIEW: custody reached the applicable maximum.');
  expect(explain(result)).toEqual(expect.arrayContaining([{ key: 'lane.APPLY_NOW' }, { key: 'lane.LAWYER_REVIEW' }]));
});

it('retains juvenile and mental-health review reasons with a death-eligible charge', () => {
  const result = run('2025-05-02', { charges: [fir('302')] }, { juvenileClaim: 'yes', mentalIllness: 'yes' });
  expect(result.status).toBe('NEEDS_LAWYER_REVIEW');
  expect(result.reasons).toEqual(expect.arrayContaining([
    'Juvenile claim requires lawyer review.', 'Mental-health claim requires lawyer review.'
  ]));
});

it('retains review reasons on an outside-screen case', () => {
  const result = run('2025-05-02', { pendingStatus: 'disposed' }, { otherHolds: 'unknown' });
  expect(result.status).toBe('OUTSIDE_SCREEN');
  expect(result.reasons).toContain('Other holds are unknown.');
});

it('distinguishes an absent continuation order from an explicit unknown', () => {
  const missing = run('2025-05-02');
  const unknown = run('2025-05-02', { evidence: { continuationOrder: fact('unknown') } });
  expect(missing.trace.find(step => step.id === 'threshold')?.inputs.continuationOrder).toBe('no record');
  expect(unknown.trace.find(step => step.id === 'threshold')?.inputs.continuationOrder).toBe('unknown');
  expect(unknown.reasons).toContain('Verify the court’s continued-detention order and written reasons.');
});

it.each([
  ['IPC', '323', '2024-07-01', '2025-01-01', 'IPC offence date is on or after 1 July 2024.'],
  ['BNS', '115(2)', undefined, '2024-06-30', 'BNS offence predates commencement based on the offence date or first custody.'],
  ['BNS', '115(2)', '2025-01-02', '2025-01-01', 'Offence date is invalid or later than first custody or the screening date.']
] as const)('reviews inconsistent offence dates for %s %s', (act, section, offenceOn, start, reason) => {
  const result = run('2025-05-02', {
    charges: [{ ...fir(section, act), offenceOn }], custody: [{ kind: 'judicial', start, ongoing: true }]
  });
  expect(result.status).toBe('NEEDS_LAWYER_REVIEW');
  expect(result.reasons).toContain(reason);
});

it('reviews a retrospective screening date that disagrees with the order', () => {
  const result = run('2025-05-02', { orderDate: '2025-05-01' });
  expect(result.status).toBe('NEEDS_LAWYER_REVIEW');
  expect(result.reasons).toContain('Screening date differs from the recorded order date.');
  expect(result.trace[0].warnings).toContain('Screening date differs from the recorded order date.');
});

it('accepts 29 February as a retrospective date in a leap year', () => {
  const result = run('2024-02-29', {
    orderDate: '2024-02-29', firstRemandOn: '2024-02-29',
    custody: [{ kind: 'judicial', start: '2024-02-29', ongoing: true }]
  });
  expect(result).toMatchObject({ status: 'DUE_IN_N_DAYS', rawCustodyDays: 1, thresholdFraction: '1/2', dueInDays: 182 });
});

it('shows unchecked claims and an omitted screened case', () => {
  const result = run('2025-05-02', {}, { caseIds: [], juvenileClaim: 'unknown', mentalIllness: 'unknown' });
  expect(result.status).toBe('NEEDS_LAWYER_REVIEW');
  expect(result.reasons).toContain('The selected case is absent from the person’s case list.');
  expect(result.trace.find(step => step.id === 'threshold')?.warnings).toEqual(expect.arrayContaining([
    'Juvenile claim not checked.', 'Mental-health claim not checked.'
  ]));
});

it('keeps CrPC half-only screening when conviction history is unknown', () => {
  const result = run('2024-06-30', {
    firstRemandOn: '2024-01-01', custody: [{ kind: 'judicial', start: '2024-01-01', ongoing: true }]
  }, { priorConviction: 'unknown' });
  expect(result).toMatchObject({ status: 'DUE_IN_N_DAYS', thresholdFraction: '1/2', dueInDays: 1 });
});

it('recognizes ongoing interim bail on the screening day', () => {
  const result = run('2025-05-02', {
    custody: [...record().custody, { kind: 'interim_bail', start: '2025-05-01', ongoing: true }]
  });
  expect(result).toMatchObject({ status: 'OUTSIDE_SCREEN', rawCustodyDays: 120, countedCustodyDays: 120 });
  expect(result.reasons).toContain('No current custody is recorded for this case.');
});

it('counts a same-day re-arrest as a new spell', () => {
  const result = run('2025-05-02', {
    releasedOn: '2025-05-02',
    custody: [...record().custody, { kind: 'police', start: '2025-05-02', ongoing: true }]
  });
  expect(result.rawCustodyDays).toBe(122);
  expect(result.trace.find(step => step.id === 'custody')?.inputs.detention).toEqual([
    { start: '2025-01-01', endExclusive: '2025-05-02' },
    { start: '2025-05-02', endExclusive: '2025-05-03' }
  ]);
});

it('uses the custody calendar for dated offence lookups', () => {
  const result = run('2025-10-30', {
    charges: [fir('337')], custody: [{ kind: 'judicial', start: '2025-08-31', ongoing: true }]
  });
  expect(lookupOffence('IPC', '337', undefined, '2025-08-31')?.maxDays).toBe(181);
  expect(result.maxTermDays).toBe(181);
  expect(lookupOffence('IPC', '337')?.maxDays).toBe(181);
});

it('includes the day before first remand in police custody without an outside-window alert', () => {
  const result = policeCustodyCheck(record({
    firstRemandOn: '2025-01-02', custody: [{ kind: 'police', start: '2025-01-01', end: '2025-01-04' }]
  }), 365);
  expect(result).toMatchObject({ policeDays: 3, withinWindow: true, alerts: [] });
});

it('flags police custody recorded more than one day before first remand', () => {
  const result = policeCustodyCheck(record({
    firstRemandOn: '2025-01-03', custody: [{ kind: 'police', start: '2025-01-01', end: '2025-01-04' }]
  }), 365);
  expect(result.alerts).toContainEqual(expect.objectContaining({ kind: 'POLICE_CUSTODY_OUTSIDE_WINDOW' }));
});

it('requires an order date to count an ongoing police spell in the standalone check', () => {
  const c = record({ custody: [{ kind: 'police', start: '2025-01-01', ongoing: true }] });
  expect(policeCustodyCheck(c, 365)).toMatchObject({ policeDays: 0, withinWindow: false });
  const dated = policeCustodyCheck({ ...c, orderDate: '2025-01-16' }, 365);
  expect(dated.policeDays).toBe(16);
  expect(dated.alerts).toContainEqual(expect.objectContaining({ kind: 'POLICE_CUSTODY_OVER_15' }));
});

it.each([['IPC', '365'], ['BNS', '140(3)']] as const)('%s %s is non-bailable under the First Schedule', (act, section) => {
  const result = run('2025-01-08', { charges: [fir(section, act)],
    evidence: { arrestedOn: fact('2025-01-01'), bailBondsFurnished: fact('no') }
  });
  expect(result.trace.find(step => step.id === 'follow-up')?.inputs.bailable).toBe('no');
  expect(result.nalsaCategories).not.toContain(5);
  expect(alert(result, 'S478_INDIGENCE')).toBeUndefined();
});

it('links penalties and detention authorities to the checked official sources', () => {
  expect(lookupOffence('IPC', '302')?.source).toBe('https://www.indiacode.nic.in/repealedfileopen?rfilename=A1860-45.pdf#page=74');
  expect(lookupOffence('BNS', '331(1)')?.source).toMatch(/indiacode\.nic\.in.*#page=100$/);
  expect(lookupOffence('EXCISE', '34(2)repeat')?.source).toMatch(/indiacode\.gov\.in.*#page=59$/);
  const bnss = run('2025-05-02').trace.find(step => step.id === 'governing-law');
  const crpc = run('2024-05-02').trace.find(step => step.id === 'governing-law');
  expect(bnss?.authority?.[0].url).toContain('/21920/');
  expect(crpc?.authority?.[0].url).toContain('/15272/');
});
