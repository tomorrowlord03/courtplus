export interface HearingPublicationPayload {
  kind: 'courtplus-hearing-summary-v1';
  caseRef: string;
  recordingId: string;
  hearingDate: string;
  nextDate: string | null;
  summary: string;
  approvedAt: string;
}

export interface SignedHearingPublication {
  payload: HearingPublicationPayload;
  hash: string;
  signature: string;
  keyId: string;
  publicKey: string;
}

export interface HearingPublishApi {
  publishSummary(id: string, summary: string, approved: true): Promise<{ published: true }>;
}

export interface PublicHearingSummary {
  hearingDate: string;
  nextDate: string | null;
  summary: string;
  verification: 'valid' | 'invalid';
}

export interface PublicCaseTrack {
  stage: 'investigation' | 'inquiry' | 'trial' | 'appeal' | 'disposed' | null;
  hearingDates: string[];
  nextDate: string | null;
  summaries: PublicHearingSummary[];
}
