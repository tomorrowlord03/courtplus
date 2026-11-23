import type { ScreeningResult } from '@courtplus/contracts';
import type { DraftData } from '../src/index.js';

export const result: ScreeningResult = {
  personId: 'fictional-person',
  caseId: 'fictional-case',
  asOf: '2025-04-24',
  ruleVersion: 'fictional-test-rules',
  dayConvention: 'Custody days are counted as of the stated date.',
  status: 'APPLY_NOW',
  thresholdFraction: '1/3',
  thresholdDate: '2025-04-22',
  maxTermDays: 360,
  rawCustodyDays: 122,
  countedCustodyDays: 122,
  ceilingUrgent: false,
  reasons: ['The recorded custody exceeds the threshold.'],
  alerts: [],
  nalsaCategories: [],
  trace: [{
    id: 'fictional-threshold',
    label: 'Custody threshold',
    inputs: { maxTermDays: 360 },
    operation: '360 × 1/3',
    result: '120 days',
  }],
};

const person = { alias: 'Fictional Undertrial A' };
const prison = 'Fictional Sample Jail';
const caseRecord = { court: 'Fictional Sample Court', caseNo: 'FICTIONAL-CASE-01' };
const staff = { verifiedBy: 'Fictional Reviewer', attestedBy: 'Fictional Superintendent' };

export const drafts: DraftData = {
  S479_3_APPLICATION: {
    person, prison, result, ...staff,
    caseRecord: { ...caseRecord, charges: [{ act: 'OTHER', section: 'Fictional', stage: 'FIR', verified: true }] },
  },
  DLSA_7_DAY: {
    person, prison, ...staff,
    caseRecord: { ...caseRecord, bailGrantedOn: '2025-04-16' },
    district: 'Fictional Sample District',
    custodyCheckedOn: result.asOf,
    releaseBarrier: 'Fictional surety pending',
  },
  AI_ASSISTANCE_NOTE: {
    model: 'Fictional Test Model',
    orderReference: 'FICTIONAL-ORDER-01',
    suggestedFields: ['Case reference', 'Date of bail order'],
    confirmedBy: 'Fictional Reviewer',
  },
  RIGHTS_CARD: { dlsaName: 'Fictional DLSA', dlsaPhone: '0000 0000' },
  DLSA_HANDOFF: {
    date: result.asOf, prison, dlsaName: 'Fictional DLSA', auditLogHead: 'a'.repeat(64),
    handedOverBy: 'Fictional Superintendent', receivedBy: 'Fictional DLSA Receiver',
  },
};
