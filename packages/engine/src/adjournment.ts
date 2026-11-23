import type { AdjournmentAdvice, AdjournmentRequest, AdjournmentSummary, Authority, Hearing } from '@courtplus/contracts';
import { day } from './dates.js';
import { bnss } from './jai.js';

const cpc: Authority = {
  act: 'Code of Civil Procedure, 1908', section: 'Order XVII Rule 1(1)',
  text: 'The proviso limits such adjournments to three per party during the hearing of the suit. Sufficient cause and written reasons are required.',
  url: 'https://www.indiacode.nic.in/bitstream/123456789/2191/5/190805.pdf',
};
const criminal: Authority = {
  act: 'Bharatiya Nagarik Suraksha Sanhita, 2023', section: '346',
  text: 'In an inquiry or trial, proceed day to day until witnesses in attendance are examined unless delay beyond the next day is necessary for recorded reasons. For circumstances beyond a party’s control, subsection (2) separately limits adjournments to two, with recorded reasons and objections heard.',
  url: bnss,
};

const partyKey = (party: string) => party.trim().replace(/\s+/g, ' ').toLowerCase();

export function adjournmentHistory(hearings: readonly Hearing[], caseId: string, asOf: string): AdjournmentSummary[] {
  const total: AdjournmentSummary = { count: 0, daysLost: 0, unknownDays: 0 };
  const parties = new Map<string, AdjournmentSummary>();
  for (const hearing of hearings) {
    if (hearing.caseId !== caseId || hearing.outcome !== 'adjourned' || hearing.date > asOf) continue;
    const key = partyKey(hearing.adjournedBy ?? '');
    const summary = parties.get(key) ?? { party: key ? hearing.adjournedBy : 'Unattributed', count: 0, daysLost: 0, unknownDays: 0 };
    for (const item of [total, summary]) {
      item.count++;
      item.daysLost += hearing.grantedDays ?? 0;
      item.unknownDays += hearing.grantedDays === undefined ? 1 : 0;
    }
    parties.set(key, summary);
  }
  return [total, ...parties.values()];
}

function ordinal(n: number): string {
  const digit = n % 10;
  return n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][digit] ?? 'th');
}

export function adviseAdjournment(request: AdjournmentRequest, hearings: readonly Hearing[], minimumDays: number,
  calendar: readonly AdjournmentAdvice['workload'][number][]): AdjournmentAdvice {
  const history = adjournmentHistory(hearings, request.caseId, request.date);
  const prior = history.find(row => row.party !== undefined && partyKey(row.party) === partyKey(request.party))?.count ?? 0;
  const authority = request.procedure === 'cpc' ? cpc : request.procedure === 'bnss' ? criminal : undefined;
  const legalNote = authority ? authority.text + (request.procedure === 'cpc' && prior >= 3
    ? ' At least three are recorded for this party. Verify which entries count under the proviso before deciding.' : '')
    : 'Confirm the applicable procedural rule before deciding.';
  const on = day(request.date)!;
  const workload = calendar.filter(item => item.date > request.date).sort((a, b) => a.date.localeCompare(b.date));
  const eligible = workload.find(item => {
    const days = day(item.date)! - on;
    return item.available > 0 && days >= minimumDays && days <= request.requestedDays;
  });
  const suggestion = eligible && { date: eligible.date, days: day(eligible.date)! - on };
  const reason = suggestion
    ? `First confirmed cause-list date with capacity that allows at least ${minimumDays} preparation day(s).`
    : request.requestedDays < minimumDays ? `The request is shorter than the ${minimumDays}-day preparation minimum.`
      : 'No confirmed cause-list date has capacity within the preparation and request window.';
  return { history, pattern: `${ordinal(prior + 1)} adjournment if granted to this party`, legalNote, authority,
    workload: workload.filter((item, index) => index < 15 || item === eligible), suggestion, reason };
}
