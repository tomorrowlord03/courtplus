import { createHash } from 'node:crypto';
import { PNG } from 'pngjs';
import canonicalize from 'canonicalize';
import { describe, expect, it } from 'vitest';
import {
  createManifest, createReceipt, createStoredKey, decodeReceiptQr, exportPublicKey, exportSignedDraft,
  generateKeyPair, retireStoredKey, verify, type KeyStorage, type Manifest, type Receipt, type Signed,
  type SigningKey,
} from '../src/index.js';
import { drafts, result } from './fixtures.js';

const pdf = Buffer.from('%PDF-1.7 fictional bytes');
const key = generateKeyPair('Fictional export key');

function bundle(signer = key) {
  const signed = createReceipt({
    issuer: 'Fictional Sample Jail', inputs: { b: 'fictional', a: 1 }, result, createdAt: new Date('2025-04-24T00:00:00Z'),
  }, signer);
  return {
    pdf,
    ...signed,
    manifest: createManifest(pdf, signed.receipt, signer),
    trustStore: [exportPublicKey(signer)],
  };
}

describe('signed export', () => {
  it('signs canonical receipt and manifest payloads and verifies the exact PDF bytes', () => {
    const signed = bundle();
    expect(verify(signed)).toEqual({ signature: 'valid', pdf: 'unchanged', chain: 'not_checked' });
    const receipt: Signed<Receipt> = JSON.parse(signed.receipt);
    const manifest: Signed<Manifest> = JSON.parse(signed.manifest);
    const sha256 = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
    expect(signed.receipt).toBe(canonicalize(receipt));
    expect(signed.manifest).toBe(canonicalize(manifest));
    expect(receipt.payload).toMatchObject({
      receiptId: signed.receiptId, issuer: 'Fictional Sample Jail', keyId: key.keyId, asOf: result.asOf,
      inputsDigest: sha256('{"a":1,"b":"fictional"}'), result: result.status,
      traceDigest: sha256(canonicalize(result.trace)!), resultDigest: sha256(canonicalize(result)!),
      ruleVersion: result.ruleVersion, createdAt: '2025-04-24T00:00:00.000Z',
    });
    expect(manifest.payload).toMatchObject({ receiptDigest: sha256(signed.receipt), pdfDigest: sha256(pdf) });
    expect(verify({ ...signed, receipt: JSON.stringify(receipt, null, 2) }).signature).toBe('valid');
  });

  it('detects a one-byte PDF edit with signatures still valid', () => {
    const signed = bundle();
    const changed = Buffer.from(pdf);
    changed[changed.length - 1] ^= 1;
    expect(verify({ ...signed, pdf: changed })).toEqual({
      signature: 'valid', pdf: 'changed', chain: 'not_checked',
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
});
