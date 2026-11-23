import type { AdjournmentDecision, CaseRecord, ISODate, JudgeDraftKind, LawyerDraftKind } from '@courtplus/contracts';
import { renderHtml, type DraftData } from './render.js';
import type { RenderOptions } from './resources.js';

export interface CaseDraftContext {
  record: CaseRecord;
  today: ISODate;
  confirmedAdjournment?: Pick<AdjournmentDecision, 'caseId' | 'date' | 'party' | 'reason' | 'nextOn' | 'purpose'>;
  confirmedStructure?: {
    caseId: string;
    facts?: string;
    issues?: readonly string[];
  };
}

type CaseDraftKind = JudgeDraftKind | LawyerDraftKind;

export function renderCaseDraft(
  kind: CaseDraftKind, context: CaseDraftContext, lang: string, options?: RenderOptions,
): string {
  const { record, today, confirmedAdjournment, confirmedStructure } = context;
  const caseFields = { court: record.court, caseNo: record.caseNo || record.cnr };
  const adjournment = confirmedAdjournment?.caseId === record.id ? confirmedAdjournment : undefined;
  const structure = confirmedStructure?.caseId === record.id ? confirmedStructure : undefined;
  const hearings = record.events.filter(event => event.kind === 'hearing' && event.source?.verifiedBy?.trim());
  const nextHearing = hearings.filter(event => event.on >= today).sort((a, b) => a.on.localeCompare(b.on))[0];
  const charges = record.charges.filter(charge => charge.verified)
    .map(charge => `${charge.act} ${charge.section}${charge.subsection ? `(${charge.subsection})` : ''}`)
    .join(', ') || undefined;
  const policeStation = record.policeStation;

  const drafts: Pick<DraftData, CaseDraftKind> = {
    INTERIM_ORDER_SHEET: { ...caseFields, presidingOfficer: record.judgeName, nextDate: nextHearing?.on },
    NOTICE_TO_APPEAR: { ...caseFields },
    ADJOURNMENT_ORDER: {
      ...caseFields, judgeName: record.judgeName, date: adjournment?.date, requestingParty: adjournment?.party,
      reason: adjournment?.reason, nextDate: adjournment?.nextOn, nextPurpose: adjournment?.purpose,
    },
    JUDGMENT_OUTLINE: { ...caseFields, judgeName: record.judgeName, facts: structure?.facts, issues: structure?.issues },
    REGULAR_BAIL_APPLICATION: { caseNo: caseFields.caseNo, policeStation, charges },
    ANTICIPATORY_BAIL_APPLICATION: { policeStation, allegedOffences: charges },
    LEGAL_NOTICE: {},
    CHEQUE_BOUNCE_NOTICE: {},
  };
  return renderHtml(kind, drafts[kind], lang, options);
}
