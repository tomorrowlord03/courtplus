export type ReleaseDraftKind =
  | 'S479_3_APPLICATION'
  | 'DLSA_7_DAY'
  | 'AI_ASSISTANCE_NOTE'
  | 'RIGHTS_CARD';

export type JudgeDraftKind =
  | 'INTERIM_ORDER_SHEET'
  | 'NOTICE_TO_APPEAR'
  | 'ADJOURNMENT_ORDER'
  | 'JUDGMENT_OUTLINE';

export type LawyerDraftKind =
  | 'REGULAR_BAIL_APPLICATION'
  | 'ANTICIPATORY_BAIL_APPLICATION'
  | 'LEGAL_NOTICE'
  | 'CHEQUE_BOUNCE_NOTICE';

export type CourtDraftKind =
  | ReleaseDraftKind
  | JudgeDraftKind
  | LawyerDraftKind;
