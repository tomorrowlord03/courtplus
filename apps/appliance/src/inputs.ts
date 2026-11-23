import { Buffer } from 'node:buffer';
import type { CourtPlusApi } from '@courtplus/contracts';
import { z } from 'zod';
import { HttpError } from './http.js';

export const date = z.iso.date();
export const id = z.string().regex(/^(?:[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}|(?:person|personId|case|p|c|doc|accused)[-_]?\d{1,12})$/i);
export const receiptId = z.uuidv4();
export const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const timestamp = z.iso.datetime();
const tri = z.enum(['yes', 'no', 'unknown']);
const alias = z.string().regex(/^(?:Accused|Person|Prisoner|Undertrial)[ -]\d{1,12}$/i);
const provision = z.string().max(32).regex(/^[\da-z().-]*$/i);
const source = z.object({ docId: id, page: z.number().int().positive().optional(), verifiedAt: timestamp.optional() });
const charge = z.object({
  act: z.enum(['IPC', 'BNS', 'NDPS', 'UAPA', 'PMLA', 'POCSO', 'PC_ACT', 'ARMS', 'EXCISE', 'OTHER']),
  section: provision.min(1), subsection: provision.optional(), variant: provision.optional(),
  stage: z.enum(['FIR', 'FRAMED']), verified: z.boolean(), source: source.optional(),
});
const person = z.object({
  id, alias, prisonerType: z.enum(['undertrial', 'convict_appellant']),
  priorConviction: tri, otherHolds: tri, ageOver70: tri.optional(), woman: tri.optional(),
  juvenileClaim: tri.optional(), mentalIllness: tri.optional(), caseIds: z.array(id).max(1000),
});
const eventKind = z.enum([
  'remand', 'chargesheet', 'framing', 'bail_granted', 'bail_rejected',
  'acquitted', 'convicted', 'released', 'hearing', 'other',
]);
const caseRecord = z.object({
  id, personId: id, orderDate: date.optional(), charges: z.array(charge).max(100),
  custody: z.array(z.object({
    kind: z.enum(['police', 'judicial', 'interim_bail', 'accused_delay']),
    start: date, end: date.optional(), ongoing: z.boolean().optional(), source: source.optional(),
  })).max(500),
  events: z.array(z.object({ on: date, kind: eventKind, source: source.optional() })).max(500),
  firstRemandOn: date.optional(), chargesheetOn: date.optional(), defaultBailAppliedOn: date.optional(),
  readyToFurnishBail: tri.optional(), bailGrantedOn: date.optional(), releasedOn: date.optional(),
  pendingStatus: z.enum(['investigation', 'inquiry', 'trial', 'appeal', 'disposed']),
});

export const roles = z.enum(['superintendent', 'dlsa', 'legal_aid', 'utrc_member', 'admin', 'judge']);
export type Role = z.infer<typeof roles>;
export const username = z.string().regex(/^[a-z0-9][a-z0-9_.-]{2,63}$/);
export const password = z.string().min(12).max(256);
export const handoffKinds = z.enum(['release_order', 'bail_granted', 'acquitted']);
export const handoffInput = z.strictObject({ caseId: id, kind: handoffKinds, orderOn: date });
export type HandoffInput = z.infer<typeof handoffInput>;

export const cardState = z.enum(['open', 'assigned', 'order_verified', 'jail_acknowledged', 'holds_checked', 'closed']);
const cardPatch = z.strictObject({
  state: cardState.optional(),
  owner: roles.optional(),
  dueOn: date.optional(),
}).refine(patch => Object.keys(patch).length > 0);

const base64Alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const maxVerifyBytes = 4 * 1024 * 1024;
export const maxVerifyBase64 = 4 * Math.ceil(maxVerifyBytes / 3);
const encodedBytes = z.strictObject({ $base64: z.string().min(4).max(maxVerifyBase64) })
  .transform(({ $base64 }, context) => {
    const padding = $base64.endsWith('==') ? 2 : $base64.endsWith('=') ? 1 : 0;
    const end = $base64.length - padding;
    const tailBits = padding === 2 ? 15 : padding === 1 ? 3 : 0;
    // Canonical base64 requires the unused bits in the final sextet to be zero.
    if ($base64.length % 4 !== 0 || $base64.length / 4 * 3 - padding > maxVerifyBytes
      || /[^A-Za-z0-9+/]/.test($base64.slice(0, end))
      || (base64Alphabet.indexOf($base64[end - 1]) & tailBits) !== 0) {
      context.addIssue({ code: 'custom', message: 'Invalid base64' });
      return z.NEVER;
    }
    return Buffer.from($base64, 'base64');
  });

export const envelopes = z.strictObject({ receipt: z.string().min(1).max(4096), manifest: z.string().min(1).max(2048) });
type ApiSchemas = { [K in keyof CourtPlusApi]: z.ZodType<Parameters<CourtPlusApi[K]>> };
export const apiInputs = {
  listPersons: z.tuple([]),
  listCases: z.tuple([]),
  importOrder: z.tuple([z.strictObject({ name: z.string().min(1).max(255), bytes: encodedBytes })]),
  saveCase: z.tuple([person, caseRecord]).refine(([p, c]) => p.id === c.personId),
  screen: z.tuple([id, date]),
  board: z.tuple([date]),
  updateCard: z.tuple([z.string().min(1).max(128), cardPatch]),
  exportDraft: z.tuple([
    z.enum(['S479_3_APPLICATION', 'DLSA_7_DAY', 'AI_ASSISTANCE_NOTE', 'RIGHTS_CARD']),
    id,
    z.string().regex(/^[a-z]{2,3}(?:-[a-zA-Z]{2,8})?$/),
  ]),
  exportScReturn: z.tuple([date, z.enum(['xlsx', 'csv'])]),
  verify: z.tuple([envelopes.extend({ pdf: encodedBytes })]),
  stats: z.tuple([]),
  role: z.tuple([]),
  judgeDashboard: z.tuple([date.optional(), z.string().optional()]),
} satisfies ApiSchemas;

export function forbidden(): never {
  throw new HttpError(403, 'FORBIDDEN');
}
