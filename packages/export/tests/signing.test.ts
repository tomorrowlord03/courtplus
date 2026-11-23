import { createHash, createPrivateKey, sign } from 'node:crypto';
import { PNG } from 'pngjs';
import canonicalize from 'canonicalize';
import { describe, expect, it } from 'vitest';
import {
  createManifest, createReceipt, createStoredKey, decodeReceiptQr, exportPublicKey, exportSignedDraft,
  generateKeyPair, retireStoredKey, verify, type KeyStorage, type Manifest, type Receipt, type Signed,
  type SigningKey,
} from '../src/index.js';
import { drafts, result } from './fixtures.js';
import {
  decodeTrustPem, encodeTrustPem, generatePqKeyPair, keyBinding, signHybrid,
  type HybridManifest, type HybridReceipt, type HybridSigned,
} from '../src/signing.js';

const pdf = Buffer.from('%PDF-1.7 fictional bytes');
const key = generateKeyPair('Fictional export key');

function bundle(signer = key, options?: { legacy: true }) {
  const signed = createReceipt({
    issuer: 'Fictional Sample Jail', inputs: { b: 'fictional', a: 1 }, result, createdAt: new Date('2025-04-24T00:00:00Z'),
  }, signer, options);
  return {
    pdf,
    ...signed,
    manifest: createManifest(pdf, signed.receipt, signer, options),
    trustStore: [exportPublicKey(signer)],
  };
}

describe('signed export', () => {
  it('signs canonical receipt and manifest payloads and verifies the exact PDF bytes', () => {
    const signed = bundle();
    const verified = verify(signed);
    const receipt: HybridSigned<HybridReceipt> = JSON.parse(signed.receipt);
    const manifest: HybridSigned<HybridManifest> = JSON.parse(signed.manifest);
    const sha256 = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
    const sha3 = (value: string | Uint8Array) => createHash('sha3-256').update(value).digest('hex');
    const pqKeyId = sha256(Buffer.from(key.pqPublicKey!, 'base64'));
    expect(verified).toEqual({
      signature: 'valid', pdf: 'unchanged', chain: 'not_checked',
      signatures: { ed25519: true, mldsa65: true }, hashes: { sha256: sha256(pdf), sha3_256: sha3(pdf) },
    });
    expect(signed.receipt).toBe(canonicalize(receipt));
    expect(signed.manifest).toBe(canonicalize(manifest));
    expect(receipt.payload).toMatchObject({
      kind: 'courtplus-receipt-v2', receiptId: signed.receiptId, issuer: 'Fictional Sample Jail', keyId: key.keyId, asOf: result.asOf,
      inputsDigest: sha256('{"a":1,"b":"fictional"}'), result: result.status,
      traceDigest: sha256(canonicalize(result.trace)!), resultDigest: sha256(canonicalize(result)!),
      ruleVersion: result.ruleVersion, createdAt: '2025-04-24T00:00:00.000Z', pqKeyId,
    });
    const { hashes, ...fields } = receipt.payload;
    expect(hashes).toEqual({ sha256: sha256(canonicalize(fields)!), sha3_256: sha3(canonicalize(fields)!) });
    expect(manifest.payload).toMatchObject({ pqKeyId, receiptDigest: sha256(signed.receipt), pdfDigest: sha256(pdf), pdfSha3_256: sha3(pdf) });
    expect(verify({ ...signed, receipt: JSON.stringify(receipt, null, 2) }).signature).toBe('valid');
  });

  it('detects a one-byte PDF edit with signatures still valid', () => {
    const signed = bundle();
    const changed = Buffer.from(pdf);
    changed[changed.length - 1] ^= 1;
    expect(verify({ ...signed, pdf: changed })).toMatchObject({
      signature: 'valid', pdf: 'changed', chain: 'not_checked',
    });
  });

  it('invalidates a one-byte edit to the signed receipt payload', () => {
    const signed = bundle();
    const receipt = signed.receipt.replace('Sample Jail', 'Sample Bail');
    expect(verify({ ...signed, receipt })).toMatchObject({ signature: 'invalid', pdf: 'changed' });
  });

  it.each(['ed25519', 'mldsa65'] as const)('requires the %s signature on both v2 files', algorithm => {
    const signed = bundle();
    for (const file of ['receipt', 'manifest'] as const) {
      const envelope = JSON.parse(signed[file]) as { signatures: Partial<HybridSigned<unknown>['signatures']> };
      delete envelope.signatures[algorithm];
      expect(verify({ ...signed, [file]: JSON.stringify(envelope) })).toMatchObject({
        signature: 'invalid', pdf: 'changed', signatures: { [algorithm]: false },
      });
    }
  });

  it('rejects relabelling v2 as v1 even with the Ed25519-only envelope', () => {
    const signed = bundle();
    const envelope = JSON.parse(signed.receipt) as HybridSigned<HybridReceipt>;
    const { hashes, ...fields } = envelope.payload;
    const receipt = canonicalize({
      payload: { ...fields, kind: 'courtplus-receipt-v1' }, signature: envelope.signatures.ed25519,
    })!;
    expect(verify({ ...signed, receipt })).toMatchObject({ signature: 'invalid', pdf: 'changed' });
  });

  it('still verifies a v1 bundle issued with only an Ed25519 key', () => {
    const sha256 = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
    const legacySign = <T>(payload: T): string => canonicalize({
      payload, signature: sign(null, Buffer.from(canonicalize(payload)!), createPrivateKey(key.privateKey)).toString('base64url'),
    } satisfies Signed<T>)!;
    const receipt = legacySign<Receipt>({
      kind: 'courtplus-receipt-v1', receiptId: 'a0000000-0000-4000-8000-000000000001', issuer: 'Fictional Sample Jail',
      keyId: key.keyId, asOf: result.asOf, result: result.status, ruleVersion: result.ruleVersion,
      inputsDigest: sha256('{}'), resultDigest: sha256(canonicalize(result)!), traceDigest: sha256(canonicalize(result.trace)!),
      createdAt: '2025-04-24T00:00:00.000Z',
    });
    const manifest = legacySign<Manifest>({
      kind: 'courtplus-manifest-v1', keyId: key.keyId, receiptDigest: sha256(receipt), pdfDigest: sha256(pdf),
    });
    const { pqPublicKey, pqKeyId, ...legacyKey } = exportPublicKey(key);
    expect(verify({ pdf, receipt, manifest, trustStore: [legacyKey] }))
      .toEqual({ signature: 'valid', pdf: 'unchanged', chain: 'not_checked' });
    expect(verify({ pdf, receipt, manifest, trustStore: [exportPublicKey(key)] })).toEqual({
      signature: 'valid', pdf: 'unchanged', chain: 'not_checked',
      legacy: true, signatures: { ed25519: true, mldsa65: false },
    });
  });

  it('requires an explicit legacy option and preserves the v1 envelope format', () => {
    const { pqPublicKey, pqPrivateKey, pqKeyId, ...legacy } = key;
    expect(() => bundle(legacy)).toThrow('ML-DSA-65 signing key is missing');
    const signed = bundle(legacy, { legacy: true });
    expect(() => createManifest(pdf, signed.receipt, legacy)).toThrow('ML-DSA-65 signing key is missing');
    const sha256 = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
    const expectedEnvelope = <T>(payload: T) => canonicalize({
      payload, signature: sign(null, Buffer.from(canonicalize(payload)!), createPrivateKey(legacy.privateKey)).toString('base64url'),
    } satisfies Signed<T>);
    expect(signed.receipt).toBe(expectedEnvelope<Receipt>({
      kind: 'courtplus-receipt-v1', receiptId: signed.receiptId, issuer: 'Fictional Sample Jail', keyId: key.keyId,
      asOf: result.asOf, ruleVersion: result.ruleVersion, result: result.status, createdAt: '2025-04-24T00:00:00.000Z',
      inputsDigest: sha256('{"a":1,"b":"fictional"}'), resultDigest: sha256(canonicalize(result)!),
      traceDigest: sha256(canonicalize(result.trace)!),
    }));
    expect(signed.manifest).toBe(expectedEnvelope<Manifest>({
      kind: 'courtplus-manifest-v1', keyId: key.keyId, receiptDigest: sha256(signed.receipt), pdfDigest: sha256(pdf),
    }));
    expect(verify(signed)).toEqual({ signature: 'valid', pdf: 'unchanged', chain: 'not_checked' });
  });

  it('rejects a substituted ML-DSA-65 key in a trust PEM and a v2 bundle', () => {
    const original = exportPublicKey(key);
    const replacement = generatePqKeyPair();
    const mismatched = { ...original, pqPublicKey: replacement.pqPublicKey, binding: keyBinding(key) };
    expect(() => decodeTrustPem(encodeTrustPem(mismatched))).toThrow('The ML-DSA-65 key is not bound to this Ed25519 key');

    const signed = bundle({ ...key, ...replacement });
    expect(verify(signed).signature).toBe('valid');
    expect(verify({ ...signed, trustStore: [mismatched] })).toMatchObject({
      signature: 'invalid', signatures: { ed25519: true, mldsa65: false },
    });
  });

  it('rejects signatures made with an ML-DSA-65 key that differs from the signed fingerprint', () => {
    const original = bundle();
    const signedReceipt: HybridSigned<HybridReceipt> = JSON.parse(original.receipt);
    const signedManifest: HybridSigned<HybridManifest> = JSON.parse(original.manifest);
    const replacement = { ...key, ...generatePqKeyPair() };
    const receipt = canonicalize(signHybrid(signedReceipt.payload, replacement))!;
    const receiptDigest = createHash('sha256').update(receipt).digest('hex');
    const manifest = canonicalize(signHybrid({ ...signedManifest.payload, receiptDigest }, replacement))!;
    const trustStore = [{ ...exportPublicKey(key), pqPublicKey: replacement.pqPublicKey }];
    expect(verify({ pdf, receipt, manifest, trustStore })).toMatchObject({
      signature: 'invalid', signatures: { ed25519: true, mldsa65: false },
    });
  });

  it('reports an unknown signer for a v2 bundle when only its Ed25519 key is trusted', () => {
    const { pqPublicKey, pqKeyId, ...ed25519Only } = exportPublicKey(key);
    expect(verify({ ...bundle(), trustStore: [ed25519Only] })).toMatchObject({
      signature: 'unknown_signer', signatures: { ed25519: true, mldsa65: false },
    });
  });

  it('rejects another valid receipt signed by the same key', () => {
    const signed = bundle();
    expect(verify({ ...signed, receipt: bundle().receipt })).toMatchObject({
      signature: 'invalid', pdf: 'changed',
    });
  });

  it('detects signed manifest tampering and invalid JSON', () => {
    const signed = bundle();
    const manifest: Signed<Manifest> = JSON.parse(signed.manifest);
    manifest.payload.pdfDigest = '0'.repeat(64);
    expect(verify({ ...signed, manifest: JSON.stringify(manifest) }).signature).toBe('invalid');
    expect(verify({ ...signed, receipt: '{' }).signature).toBe('invalid');
  });

  it('flags an unknown signer', () => {
    const signed = bundle();
    expect(verify({ ...signed, trustStore: [exportPublicKey(generateKeyPair('Other fictional key'))] }).signature)
      .toBe('unknown_signer');
  });

  it('uses shell key storage, keeps retired keys trusted, and blocks their signing', async () => {
    const stored = new Map<string, SigningKey>();
    const storage: KeyStorage = {
      load: (id) => stored.get(id),
      save: (signer) => { stored.set(signer.keyId, signer); },
    };
    const active = await createStoredKey(storage, 'Fictional jail key');
    expect(active).not.toHaveProperty('privateKey');
    expect(active).not.toHaveProperty('pqPrivateKey');
    expect(active.pqPublicKey).toBeTruthy();
    const signed = bundle(stored.get(active.keyId)!);
    const retired = await retireStoredKey(storage, active.keyId);
    const retiredKey = stored.get(retired.keyId)!;
    expect(retired.status).toBe('retired');
    expect(verify({ ...signed, trustStore: [retired] }).signature).toBe('valid');
    expect(() => bundle(retiredKey)).toThrow('Only an active key may sign');
    expect(() => createManifest(pdf, signed.receipt, retiredKey)).toThrow('Only an active key may sign');
  });

  it('compares the handoff anchor and audit head independently of the PDF', () => {
    const signed = bundle();
    const anchor = drafts.DLSA_HANDOFF.auditLogHead;
    expect(verify({ ...signed, anchor }).chain).toBe('not_checked');
    expect(verify({ ...signed, anchor, auditLogHead: anchor }).chain).toBe('intact');
    expect(verify({ ...signed, anchor, auditLogHead: 'b'.repeat(64) }).chain).toBe('mismatch');
  });

  it('places only the receipt lookup values in the printed QR and seals the callback bytes', async () => {
    let printed = '';
    const signed = await exportSignedDraft('RIGHTS_CARD', drafts.RIGHTS_CARD, 'en', {
      key, issuer: 'Fictional Sample Jail', inputs: { fictional: true }, result,
      print(html) {
        printed = html;
        return pdf;
      },
    });
    const png = /src="data:image\/png;base64,([A-Za-z0-9+/=]+)"/.exec(printed)?.[1];
    expect(png).toBeTruthy();
    const image = PNG.sync.read(Buffer.from(png!, 'base64'));
    expect(decodeReceiptQr({ ...image, data: Uint8ClampedArray.from(image.data) })).toEqual({
      receiptId: signed.receiptId, keyId: key.keyId, receiptDigestPrefix: signed.receiptDigest.slice(0, 16),
    });
    expect(signed.pdf).toEqual(Uint8Array.from(pdf));
    expect(verify({ ...signed, trustStore: [exportPublicKey(key)] }).pdf).toBe('unchanged');
    expect(decodeReceiptQr({ data: new Uint8ClampedArray(4), width: 1, height: 1 })).toBeUndefined();
  });

  const kinds = Object.keys(drafts) as (keyof typeof drafts)[];
  const localizedDrafts = kinds.flatMap(kind => (['en', 'hi'] as const).map(lang => [kind, lang] as const));

  it.each(localizedDrafts)(
    'signs and verifies %s in %s',
    async (kind, lang) => {
      const signed = await exportSignedDraft(kind, drafts[kind], lang, {
        key,
        issuer: 'Fictional Court / Office',
        inputs: { fictional: true },
        result,
        print: () => pdf,
      });
      const verified = verify({
        pdf: signed.pdf,
        receipt: signed.receipt,
        manifest: signed.manifest,
        trustStore: [exportPublicKey(key)],
      });
      expect(verified).toMatchObject({ signature: 'valid', pdf: 'unchanged', chain: 'not_checked' });
    },
  );
});
