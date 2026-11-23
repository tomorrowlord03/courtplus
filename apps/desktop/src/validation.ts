import type { DesktopWorkspaceApi } from '@courtplus/contracts' with { 'resolution-mode': 'import' };
import { profileSchema } from './handlers/settings';
import { z } from 'zod';

const id = z.string().min(1);
const civilDate = z.iso.date();
const tri = z.enum(['yes', 'no', 'unknown']);
const bytes = z.instanceof(Uint8Array).refine(value => value.byteLength > 0);
const source = z.strictObject({
  docId: id,
  page: z.number().int().positive().optional(),
  quote: z.string().optional(),
  verifiedBy: z.string().optional(),
  verifiedAt: z.string().optional(),
});

const person = z.strictObject({
  id,
  alias: z.string().min(1),
  prisonerType: z.enum(['undertrial', 'convict_appellant']),
  priorConviction: tri,
  otherHolds: tri,
  ageOver70: tri.optional(),
  woman: tri.optional(),
  juvenileClaim: tri.optional(),
  mentalIllness: tri.optional(),
  caseIds: z.array(id),
});

const caseRecord = z.strictObject({
  id,
  personId: id,
  cnr: z.string().optional(),
  caseNo: z.string().optional(),
  court: z.string().optional(),
  policeStation: z.string().optional(),
  orderDate: civilDate.optional(),
  charges: z.array(z.strictObject({
    act: z.enum(['IPC', 'BNS', 'NDPS', 'UAPA', 'PMLA', 'POCSO', 'PC_ACT', 'ARMS', 'EXCISE', 'OTHER']),
    section: z.string().min(1),
    subsection: z.string().optional(),
    variant: z.string().optional(),
    stage: z.enum(['FIR', 'FRAMED']),
    verified: z.boolean(),
    source: source.optional(),
  })),
  custody: z.array(z.strictObject({
    kind: z.enum(['police', 'judicial', 'interim_bail', 'accused_delay']),
    start: civilDate,
    end: civilDate.optional(),
    ongoing: z.boolean().optional(),
    source: source.optional(),
  })),
  events: z.array(z.strictObject({
    on: civilDate,
    kind: z.enum([
      'remand', 'chargesheet', 'framing', 'bail_granted', 'bail_rejected',
      'acquitted', 'convicted', 'released', 'hearing', 'other',
    ]),
    note: z.string().optional(),
    source: source.optional(),
  })),
  firstRemandOn: civilDate.optional(),
  chargesheetOn: civilDate.optional(),
  defaultBailAppliedOn: civilDate.optional(),
  readyToFurnishBail: tri.optional(),
  bailGrantedOn: civilDate.optional(),
  releasedOn: civilDate.optional(),
  pendingStatus: z.enum(['investigation', 'inquiry', 'trial', 'appeal', 'disposed']),
});

const cardPatch = z.strictObject({
  id,
  lane: z.enum(['APPLY_NOW', 'DUE_30', 'LAWYER_REVIEW', 'BAIL_NOT_RELEASED', 'COURT_JAIL_MISMATCH', 'NO_UPDATE_180']),
  personId: id,
  caseId: id,
  title: z.string(),
  owner: z.string(),
  dueOn: civilDate,
  state: z.enum(['open', 'assigned', 'order_verified', 'jail_acknowledged', 'holds_checked', 'closed']),
  tags: z.array(z.string()),
}).partial();

export const roleSchema = z.enum(['legal_aid', 'utrc', 'superintendent', 'dlsa']);

type ApiSchemas = { [K in keyof DesktopWorkspaceApi]: z.ZodType<Parameters<DesktopWorkspaceApi[K]>> };
const draftRequest = z.tuple([
  z.enum(['S479_3_APPLICATION', 'DLSA_7_DAY', 'AI_ASSISTANCE_NOTE', 'RIGHTS_CARD']),
  id,
  z.string().min(1),
]);

export const argumentSchemas = {
  listPersons: z.tuple([]),
  listCases: z.tuple([]),
  getProfile: z.tuple([]),
  saveProfile: z.tuple([profileSchema]),
  clearProfile: z.tuple([]),
  dashboardActivity: z.tuple([]),
  previewDraft: draftRequest,
  importOrder: z.tuple([z.strictObject({ name: z.string().min(1), bytes })]),
  saveCase: z.tuple([person, caseRecord]).refine(([p, c]) => p.id === c.personId, {
    path: [1, 'personId'],
  }),
  screen: z.tuple([id, civilDate]),
  board: z.tuple([civilDate]),
  updateCard: z.tuple([id, cardPatch]),
  exportDraft: draftRequest,
  exportScReturn: z.tuple([civilDate, z.enum(['xlsx', 'csv'])]),
  verify: z.tuple([z.strictObject({ pdf: bytes, receipt: z.string().min(1), manifest: z.string().min(1) })]),
  stats: z.tuple([]),
  role: z.tuple([]),
} satisfies ApiSchemas;

export function validateArguments<T>(schema: z.ZodType<T>, args: unknown[]): T {
  const result = schema.safeParse(args);
  if (result.success) return result.data;
  const path = result.error.issues[0]?.path.map(String).join('.');
  throw new Error(path ? `INVALID_ARGUMENT at ${path}` : 'INVALID_ARGUMENT');
}
