import type { Authority, CaseMeta, CaseTier, Hearing, ISODate, Status } from '@courtplus/contracts';
import { juvenile } from './authority.js';
import { day } from './dates.js';
import { cheque, chequeTarget, childProtection, countAdjournments, disabilityAccess, fiveYearMark, niaPrecedence, njdg,
  undertrialCustody } from './jai.js';

const childCustody: Authority = {
  act: 'Juvenile Justice (Care and Protection of Children) Act, 2015', section: '12',
  text: 'Sets bail safeguards for a child alleged to be in conflict with law.',
  url: juvenile.url,
};
const conference = 'Chief Justices’ Conference, 2016';
const resolutions = 'https://api.sci.gov.in/pdf/sciconf/Resolutions%20adopted%20in%20the%20Chief%20Justices%27%20Conference%2C%202016.pdf';
const oldCases: Authority = {
  act: conference, section: 'Resolution 8',
  text: 'Prioritises disposal of cases pending for more than five years.',
  url: resolutions + '#page=16',
};
const protectedParties: Authority = {
  act: conference, section: 'Resolution 11',
  text: 'Calls for prioritising disposal of cases pertaining to women and senior citizens, among other groups.',
  url: resolutions + '#page=21',
};
const adjournmentLimit: Authority = {
  act: 'Code of Civil Procedure, 1908', section: 'Order XVII Rule 1(1) proviso',
  text: 'The proviso limits adjournments to three per party during the hearing of a suit. This tier counts all recorded adjournments of the case, regardless of which party sought them, so it is a prompt to check and not a finding of non-compliance.',
  url: 'https://www.indiacode.nic.in/bitstream/123456789/2191/1/A1908-05.pdf',
};

export type StatutoryCheck = { status: Status; asOf: ISODate; dueInDays?: number; ceilingUrgent?: boolean; receiptId?: string };
export type StatutoryChecks = ReadonlyMap<string, StatutoryCheck>;

export function tierFor(meta: CaseMeta, hearings: readonly Hearing[], asOf: ISODate,
  statutory?: StatutoryChecks): CaseTier & { statutoryStatus?: Status } {
  const on = day(asOf)!;
  const filed = day(meta.filedOn)!;
  const flags = new Set(meta.partyFlags);
  const urgent: CaseTier['triggers'] = [];
  const priority: CaseTier['triggers'] = [];

  const check = statutory?.get(meta.caseId);
  if (check) {
    if (check.status === 'APPLY_NOW') urgent.push({
      rule: `BNSS s.479: ${check.ceilingUrgent ? 'Urgent: maximum reached' : 'Apply now'} (checked ${check.asOf})`,
      source: undertrialCustody,
    });
    else if (check.status === 'DUE_IN_N_DAYS' && check.dueInDays !== undefined
      && check.dueInDays >= 0 && check.dueInDays <= 30) priority.push({
      rule: `BNSS s.479 due in ${check.dueInDays} days`, source: undertrialCustody,
    });
  } else if (meta.partiesInCustody && flags.has('undertrial')) urgent.push({
    rule: 'Custody and undertrial flags recorded. Verify the detention limit separately.', source: undertrialCustody,
  });
  if (meta.partiesInCustody && flags.has('child')) urgent.push({
    rule: 'A child party is recorded and a party is in custody - check whether the child is the person in custody (JJ Act s.12).', source: childCustody,
  });
  if (meta.nationalSecurity) urgent.push({ rule: 'Case flagged as a special-statute trial (NIA Act / UAPA)', source: niaPrecedence });

  if (flags.has('seniorCitizen')) priority.push({ rule: 'Senior citizen party recorded.', source: protectedParties });
  if (flags.has('woman')) priority.push({ rule: 'Woman party recorded.', source: protectedParties });
  if (flags.has('child')) priority.push({ rule: 'Child party recorded.', source: childProtection });
  if (flags.has('disability')) priority.push({ rule: 'Party with a disability recorded.', source: disabilityAccess });
  if (on > fiveYearMark(filed)) priority.push({ rule: 'Filed more than five years ago.', source: oldCases });
  if (meta.caseType === 'cheque' && on > chequeTarget(filed)) priority.push({
    rule: 'Six-month cheque trial target passed.', source: cheque,
  });
  if (countAdjournments(meta.caseId, hearings, asOf) >= 3) priority.push(
    ['civil', 'family', 'MACT'].includes(meta.caseType)
      ? { rule: 'Three or more adjournments recorded for this case (Order XVII Rule 1(1) proviso limits adjournments to three per party in a civil suit).', source: adjournmentLimit }
      : { rule: '3+ adjournments recorded (prompt to check)', source: njdg },
  );

  const status = check ? { statutoryStatus: check.status } : {};
  if (urgent.length) return { level: 1, label: 'Liberty / custody', triggers: [...urgent, ...priority], ...status };
  if (priority.length) return { level: 2, label: 'Protected party / overdue', triggers: priority, ...status };
  return { level: 3, label: 'Regular', triggers: [], ...status };
}
