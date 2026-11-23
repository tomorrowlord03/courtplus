import type { CaseRecord, Charge, ScreeningResult } from '@courtplus/contracts';
import { offences } from '../../../../../packages/engine/src/generated/offences';
import { ui } from '../../lib/i18n';

const dateFormat = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
});

export function fullDate(iso: string) {
  const date = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(date.valueOf()) ? iso : dateFormat.format(date);
}

export function caseReference(record: CaseRecord) {
  return [record.caseNo, record.cnr].find(ref => ref && ref !== record.id &&
    !/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(ref));
}

const abbreviations = {
  BNSS: 'Bharatiya Nagarik Suraksha Sanhita',
  BNS: 'Bharatiya Nyaya Sanhita',
  IPC: 'Indian Penal Code',
  CrPC: 'Code of Criminal Procedure',
  FIR: 'First Information Report',
  UTRC: 'Undertrial Review Committee',
  DLSA: 'District Legal Services Authority',
  NALSA: 'National Legal Services Authority',
} as const;

export function CaseText({ children }: { children: string }) {
  return <>{children.split(/\b(BNSS|BNS|IPC|CrPC|FIR|UTRC|DLSA|NALSA)\b/g).map((part, i) =>
    i % 2 ? <abbr key={i} title={abbreviations[part as keyof typeof abbreviations]}>{part}</abbr> : part)}</>;
}

const provision = (section: string, subsection?: string) => section + (subsection ? `(${subsection})` : '');
const sectionKey = (value: string) => value.trim().replace(/^(?:section\b|s\.)\s*/i, '').replace(/\s/g, '').toUpperCase();

export function chargeText(charge: Charge) {
  const section = provision(charge.section, charge.subsection);
  const label = `${charge.act} ${section}`;
  const rows = offences.filter(o => o.act === charge.act && sectionKey(provision(o.section, o.subsection)) === sectionKey(section));
  const exact = rows.find(row => row.variant.toLowerCase() === (charge.variant ?? '').toLowerCase());
  const titles = new Set(rows.map(row => row.title));
  const title = exact?.title ?? (titles.size === 1 ? rows[0].title : undefined);
  return title ? `${label} - ${title}` : label;
}

export const results = {
  BAIL_NOT_RELEASED: { label: 'Bail granted, still in jail', icon: '!', tone: 'needs_lawyer_review' },
  APPLY_NOW: { label: 'Apply now', icon: '●', tone: 'apply_now' },
  NEEDS_LAWYER_REVIEW: { label: 'Needs a lawyer', icon: '▲', tone: 'needs_lawyer_review' },
  DUE_IN_N_DAYS: { label: 'Due soon', icon: '◐', tone: 'due_in_n_days' },
  OUTSIDE_SCREEN: { label: 'Outside this check', icon: '○', tone: 'outside_screen' },
} as const;

export type CaseResult = keyof typeof results;
const bailReason = 'Bail was granted. Verify the current release conditions and holds.';
const multipleReason = 'Pending offences or cases require review under BNSS s.479(2).';

export function resultKind(result: ScreeningResult): CaseResult {
  return result.reasons.includes(bailReason) || result.alerts.some(alert =>
    alert.kind === 'POST_BAIL_7_DAYS' || alert.kind === 'POST_BAIL_1_MONTH') ? 'BAIL_NOT_RELEASED' : result.status;
}

export function plainReason(reason: string) {
  if (reason === multipleReason) return 'More than one offence or pending case - a lawyer must check (BNSS s.479(2)).';
  if (reason === 'CEILING_URGENT_REVIEW: custody reached the applicable maximum.') return 'Custody has reached the maximum term. Urgent lawyer review.';
  if (reason === 'The selected case is outside the pending-undertrial screen.') return 'This check applies to people in custody who are awaiting trial.';
  if (reason === 'Applicable punishment is unresolved.') return 'The maximum sentence for the recorded charges needs to be confirmed.';
  return reason;
}

export function cardReason(result: ScreeningResult) {
  const kind = resultKind(result);
  if (kind === 'BAIL_NOT_RELEASED') return result.alerts.find(a => a.kind === 'POST_BAIL_7_DAYS' || a.kind === 'POST_BAIL_1_MONTH')?.message ?? bailReason;
  if (result.ceilingUrgent) return 'Custody has reached the maximum term. Urgent lawyer review.';
  const reasons = result.reasons;
  if (kind !== 'NEEDS_LAWYER_REVIEW') return reasons.at(-1);
  return reasons.find(reason => reason === multipleReason) ?? reasons.find(reason =>
    reason !== 'Screening date differs from the recorded order date.' && !reason.startsWith('FIR sections used provisionally.')) ?? reasons.at(-1);
}

export function ResultChip({ result }: { result: ScreeningResult }) {
  const kind = resultKind(result);
  const { label, icon, tone } = results[kind];
  const days = result.dueInDays;
  return <span className={`screening-status screening-${tone}`}>
    <span aria-hidden="true">{icon}</span>
    {kind === 'DUE_IN_N_DAYS' && days !== undefined ? `${ui('Due in')} ${days} ${ui(days === 1 ? 'day' : 'days')}` : ui(label)}
  </span>;
}
