import { createPublicKey, verify } from 'node:crypto';
import type { CourtPlusApi } from '@courtplus/contracts';
import {
  decodeTrustPem, encodeTrustPem, sha3_256, signedPayloadKind, verifyHybridDraft, type TrustEntry, type Verification,
} from '@courtplus/export/signing';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { audit, canonical, sha256, type Db } from './db.js';
import { html, HttpError, page, parse, requireValue } from './http.js';
import { digest, envelopes, receiptId, date, timestamp } from './inputs.js';

const signature = z.string().regex(/^[a-zA-Z0-9_-]{86}$/);
const officeName = z.string().trim().min(3).max(120).regex(/^[\p{L}\p{M}\p{N} .(),&/-]+$/u);
const receiptSchema = z.strictObject({
  signature,
  payload: z.strictObject({
    kind: z.literal('courtplus-receipt-v1'), receiptId, issuer: officeName, keyId: digest,
    ruleVersion: z.string().regex(/^rules-[\w.-]{1,64}$/), asOf: date,
    inputsDigest: digest, resultDigest: digest, traceDigest: digest,
    result: z.enum(['APPLY_NOW', 'DUE_IN_N_DAYS', 'NEEDS_LAWYER_REVIEW', 'OUTSIDE_SCREEN']),
    createdAt: timestamp,
  }),
});
const manifestSchema = z.strictObject({
  signature,
  payload: z.strictObject({
    kind: z.literal('courtplus-manifest-v1'), keyId: digest, receiptDigest: digest, pdfDigest: digest,
  }),
});
const signatures = z.strictObject({ ed25519: signature, mldsa65: z.string().regex(/^[a-zA-Z0-9_-]{4412}$/) });
const hybridReceipt = z.strictObject({
  signatures,
  payload: receiptSchema.shape.payload.extend({
    kind: z.literal('courtplus-receipt-v2'),
    pqKeyId: digest,
    hashes: z.strictObject({ sha256: digest, sha3_256: digest }),
  }),
});
const hybridManifest = z.strictObject({
  signatures,
  payload: manifestSchema.shape.payload.extend({
    kind: z.literal('courtplus-manifest-v2'), pqKeyId: digest, pdfSha3_256: digest,
  }),
});
type Receipt = z.infer<typeof receiptSchema> | z.infer<typeof hybridReceipt>;
type Manifest = z.infer<typeof manifestSchema> | z.infer<typeof hybridManifest>;
type Issuer = { office: string; publicKey: string };
type Stored = { receipt: string; manifest: string; withdrawn: 0 | 1 };
type Checked = Pick<Verification, 'signatures' | 'legacy'> & (
  { signature: 'unknown_signer' | 'invalid' } |
  { signature: 'valid'; issuer: Issuer; receipt: Receipt; manifest: Manifest }
);

function decode<T>(schema: z.ZodType<T>, json: string): T | undefined {
  try {
    const value = schema.safeParse(JSON.parse(json) as unknown);
    return value.success ? value.data : undefined;
  } catch (error) {
    if (error instanceof SyntaxError) return undefined;
    throw error;
  }
}

function storedIssuerKey(pem: string) {
  // Issuer rows created before bindings can still verify Ed25519 receipts.
  const pqBlock = pem.indexOf('-----BEGIN ML-DSA-65 PUBLIC KEY-----');
  if (pqBlock !== -1 && pem.trimEnd().endsWith('-----END ML-DSA-65 PUBLIC KEY-----')) {
    return decodeTrustPem(pem.slice(0, pqBlock));
  }
  return decodeTrustPem(pem);
}

export function addIssuer(db: Db, office: string, pem: string): string {
  const label = parse(officeName, office);
  const key = decodeTrustPem(pem);
  const { keyId } = key;
  db.transaction(() => {
    const existing = db.prepare<[string], Issuer>('SELECT public_key AS publicKey, office FROM issuers WHERE key_id = ?').get(keyId);
    if (existing) {
      const old = storedIssuerKey(existing.publicKey);
      if (existing.office !== label || (old.pqPublicKey && key.pqPublicKey && old.pqPublicKey !== key.pqPublicKey)) {
        throw new Error('The trusted issuer does not match this office and public key');
      }
      if (old.pqPublicKey || !key.pqPublicKey) return;
      db.prepare('UPDATE issuers SET public_key = ? WHERE key_id = ?').run(encodeTrustPem(key), keyId);
      audit(db, 'operator', 'issuer.upgrade', { keyId, office: label, pqKeyId: key.pqKeyId });
    } else {
      db.prepare('INSERT INTO issuers VALUES (?, ?, ?)').run(keyId, encodeTrustPem(key), label);
      audit(db, 'operator', 'issuer.add', { keyId, office: label });
    }
  }).immediate();
  return keyId;
}

export function createReceipts(db: Db) {
  const lookup = db.prepare<[string], Stored>('SELECT receipt, manifest, withdrawn FROM receipts WHERE id = ?');
  const issuer = db.prepare<[string], Issuer>('SELECT public_key AS publicKey, office FROM issuers WHERE key_id = ?');
  let localRotation: { keyId: string; office: string; keys: ReadonlyMap<string, TrustEntry> } | undefined;

  function check(packageData: { receipt: string; manifest: string }): Checked {
    if (signedPayloadKind(packageData.receipt) === 'courtplus-receipt-v2') {
      const hybrid = decode(hybridReceipt, packageData.receipt);
      const manifest = decode(hybridManifest, packageData.manifest);
      if (!hybrid || !manifest || hybrid.payload.keyId !== manifest.payload.keyId
        || hybrid.payload.pqKeyId !== manifest.payload.pqKeyId) return { signature: 'invalid' };
      const trusted = issuer.get(hybrid.payload.keyId);
      if (!trusted) return { signature: 'unknown_signer' };
      if (hybrid.payload.issuer !== trusted.office) return { signature: 'invalid' };
      const entry = storedIssuerKey(trusted.publicKey);
      const { keyId, publicKey, pqKeyId } = entry;
      let matched = pqKeyId === hybrid.payload.pqKeyId ? entry : undefined;
      // The configured rotation set extends trust only for a local issuer pinned to one of its keys.
      if (localRotation?.keyId === keyId && localRotation.office === trusted.office
        && pqKeyId && localRotation.keys.has(pqKeyId)) {
        matched = localRotation.keys.get(hybrid.payload.pqKeyId);
      }
      const result = verifyHybridDraft({
        ...packageData,
        pdfDigest: manifest.payload.pdfDigest,
        pdfSha3_256: manifest.payload.pdfSha3_256,
        trustStore: [{ status: 'active', label: trusted.office, ...(matched ?? { keyId, publicKey }) }],
      });
      if (!result) return { signature: 'invalid' };
      if (result.signature !== 'valid') return { signature: result.signature, signatures: result.signatures };
      return { signature: 'valid', receipt: hybrid, manifest, issuer: trusted, signatures: result.signatures };
    }
    const receipt = decode(receiptSchema, packageData.receipt);
    const manifest = decode(manifestSchema, packageData.manifest);
    if (!receipt || !manifest || receipt.payload.keyId !== manifest.payload.keyId
      || manifest.payload.receiptDigest !== sha256(canonical(receipt))) return { signature: 'invalid' };
    const trusted = issuer.get(receipt.payload.keyId);
    if (!trusted) return { signature: 'unknown_signer' };
    const entry = storedIssuerKey(trusted.publicKey);
    const key = createPublicKey(entry.publicKey);
    for (const envelope of [receipt, manifest]) {
      const bytes = Buffer.from(envelope.signature, 'base64url');
      if (bytes.toString('base64url') !== envelope.signature
        || !verify(null, Buffer.from(canonical(envelope.payload)), key, bytes)) return { signature: 'invalid' };
    }
    if (receipt.payload.issuer !== trusted.office) return { signature: 'invalid' };
    return {
      signature: 'valid', receipt, manifest, issuer: trusted,
      ...(entry.pqPublicKey && { legacy: true, signatures: { ed25519: true, mldsa65: false } }),
    };
  }

  const publish = db.transaction((input: { receipt: string; manifest: string }, actor: string) => {
    const checked = check(input);
    if (checked.signature !== 'valid') throw new HttpError(422, checked.signature.toUpperCase());
    const id = checked.receipt.payload.receiptId;
    const receipt = canonical(checked.receipt);
    const manifest = canonical(checked.manifest);
    const existing = lookup.get(id);
    if (existing) {
      if (receipt !== existing.receipt || manifest !== existing.manifest) throw new HttpError(409, 'RECEIPT_CONFLICT');
      return { id, created: false };
    }
    db.prepare('INSERT INTO receipts (id, key_id, receipt, manifest) VALUES (?, ?, ?, ?)')
      .run(id, checked.receipt.payload.keyId, receipt, manifest);
    audit(db, actor, 'receipt.publish', { id, fingerprint: checked.manifest.payload.pdfDigest });
    return { id, created: true };
  });

  const withdraw = db.transaction((id: string, actor: string) => {
    const previous = requireValue(lookup.get(id), 'RECEIPT_NOT_FOUND');
    if (previous.withdrawn === 1) return;
    db.prepare('UPDATE receipts SET withdrawn = 1 WHERE id = ?').run(id);
    audit(db, actor, 'receipt.withdraw', { id });
  });

  function verifyDigest(input: { receipt: string; manifest: string; pdfDigest: string; pdfSha3_256?: string }): Verification {
    if (input.pdfSha3_256 === undefined && signedPayloadKind(input.manifest) === 'courtplus-manifest-v2') {
      throw new HttpError(400, 'SHA3_DIGEST_REQUIRED');
    }
    const checked = check(input);
    const signatureDetails = {
      ...(checked.signatures && { signatures: checked.signatures }),
      ...(checked.legacy && { legacy: true }),
    };
    if (checked.signature !== 'valid') {
      return { signature: checked.signature, pdf: 'changed', chain: 'not_checked', ...signatureDetails };
    }
    const { payload } = checked.manifest;
    const hybrid = payload.kind === 'courtplus-manifest-v2';
    const unchanged = payload.pdfDigest === input.pdfDigest && (!hybrid || payload.pdfSha3_256 === input.pdfSha3_256);
    return {
      signature: 'valid', pdf: unchanged ? 'unchanged' : 'changed', chain: 'not_checked',
      ...signatureDetails,
      ...(hybrid && { hashes: { sha256: payload.pdfDigest, sha3_256: payload.pdfSha3_256 } }),
    };
  }
  function verifyBundle({ pdf, ...envelopes }: Parameters<CourtPlusApi['verify']>[0]) {
    return verifyDigest({ ...envelopes, pdfDigest: sha256(pdf), pdfSha3_256: sha3_256(pdf) });
  }

  return {
    check, lookup: (id: string) => lookup.get(id), publish: publish.immediate, withdraw: withdraw.immediate,
    verifyBundle, verifyDigest,
    setLocalRotation(rotation: NonNullable<typeof localRotation>) { localRotation = rotation; },
  };
}
export type Receipts = ReturnType<typeof createReceipts>;

const statusLabels: Record<Receipt['payload']['result'], string> = {
  APPLY_NOW: 'Apply now', DUE_IN_N_DAYS: 'Due soon',
  NEEDS_LAWYER_REVIEW: 'Needs lawyer review', OUTSIDE_SCREEN: 'Outside screen',
};

export function receiptRoutes(
  app: FastifyInstance, receipts: Receipts, origin: string,
  authorize: (request: FastifyRequest, action: 'publish' | 'withdraw') => { id: string },
) {
  const params = z.object({ receiptId });
  app.post('/api/receipts', { bodyLimit: 12 * 1024 }, async (request, reply) => {
    const user = authorize(request, 'publish');
    const { id, created } = receipts.publish(parse(envelopes, request.body), user.id);
    return reply.code(created ? 201 : 200).send({ receiptId: id, url: origin + '/v/' + id });
  });
  app.post('/api/receipts/:receiptId/withdraw', async (request, reply) => {
    const user = authorize(request, 'withdraw');
    receipts.withdraw(parse(params, request.params).receiptId, user.id);
    return reply.code(204).send();
  });
  app.get('/v/:receiptId', { config: { rateLimit: { max: 30 } } }, async (request, reply) => {
    reply.header('x-robots-tag', 'noindex, nofollow');
    const id = params.safeParse(request.params);
    const stored = id.success ? receipts.lookup(id.data.receiptId) : undefined;
    if (!stored) return page(reply.code(404), 'Receipt unavailable', '<p>No published receipt was found.</p>');
    const entry = receipts.check(stored);
    if (entry.signature !== 'valid') {
      return page(reply, 'Verify CourtPlus draft', '<p>Signature invalid or issuing office unknown.</p>');
    }
    const fields = [
      ['Signature', 'Valid'],
      ...(entry.legacy ? [['Signing algorithm', 'Ed25519 only (older receipt, not quantum-safe)']] : []),
      ['Document fingerprint (SHA-256)', entry.manifest.payload.pdfDigest],
      ...(entry.manifest.payload.kind === 'courtplus-manifest-v2' ? [
        ['Ed25519', 'Valid'],
        ['ML-DSA-65 (FIPS 204, quantum-safe)', 'Valid'],
        ['Document fingerprint (SHA3-256)', entry.manifest.payload.pdfSha3_256],
      ] : []),
      ['Issuing office', entry.issuer.office],
      ['Status', stored.withdrawn ? 'Withdrawn' : 'Current'],
      ['Screening status at issue', statusLabels[entry.receipt.payload.result]],
    ];
    return page(reply, 'Verify CourtPlus draft', '<dl>' + fields.map(([label, value]) =>
      '<dt>' + html(label) + '</dt><dd>' + html(value) + '</dd>').join('') + '</dl>' +
      '<p>The fingerprint identifies the signed draft. Compare it with your copy to check that the file is unchanged.</p>');
  });
}
