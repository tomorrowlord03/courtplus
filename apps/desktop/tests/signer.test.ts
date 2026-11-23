import { createCipheriv, randomBytes, scryptSync } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as exports from '@courtplus/export';
import { encodeTrustPem, generatePqKeyPair } from '@courtplus/export/signing';
import type { ScreeningResult } from '@courtplus/contracts';
import { describe, expect, it } from 'vitest';
import { createSigner } from '../src/handlers/signer';
import { verifyBundle } from '../src/handlers/verifier';
import { openStore, type Store } from '../src/store';

const keyStorage = {
  isAsyncEncryptionAvailable: async () => true,
  encryptStringAsync: async (plaintext: string) => Buffer.from(plaintext),
  decryptStringAsync: async (wrapped: Buffer) => ({ result: wrapped.toString(), shouldReEncrypt: false }),
};
const passphrase = 'fictional test passphrase';
// Fictional screening result: only the fields a receipt reads.
const result = { status: 'NEEDS_LAWYER_REVIEW', ruleVersion: 'test', asOf: '2026-11-23', trace: [] } as unknown as ScreeningResult;

function signWith(key: exports.SigningKey) {
  const { receipt } = exports.createReceipt({ issuer: 'Fictional Office', inputs: {}, result }, key);
  const pdf = Buffer.from('%PDF fictional');
  return { pdf, receipt, manifest: exports.createManifest(pdf, receipt, key) };
}

async function withSigner(run: (store: Store, clock: { now: number }) => Promise<void> | void) {
  const directory = await mkdtemp(join(tmpdir(), 'courtplus-signer-test-'));
  const store = await openStore(directory, keyStorage);
  const clock = { now: Date.parse('2026-11-23T00:00:00Z') };
  try {
    await run(store, clock);
  } finally {
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
}

describe('signing key custody', () => {
  it('upgrades a pre-existing Ed25519 key and imports the hybrid public key under the same key ID', () => withSigner(store => {
    const { pqPublicKey, pqPrivateKey, pqKeyId, ...legacy } = exports.generateKeyPair('Fictional Office');
    store.writeSettings({ 'signing-key': JSON.stringify(legacy) }, 'signer.fixture', {});
    const signer = createSigner(store, exports);
    const key = signer.key(legacy.label);
    expect(key.keyId).toBe(legacy.keyId);
    expect(key.publicKey).toBe(legacy.publicKey);
    expect(key.pqPublicKey).toBeTruthy();
    expect(JSON.parse(store.readSetting('signing-key') ?? '{}')).toMatchObject({
      keyId: legacy.keyId, pqPublicKey: key.pqPublicKey, pqPrivateKey: key.pqPrivateKey,
    });
    const peer = exports.generateKeyPair('Fictional Peer');
    expect(signer.trust(peer.publicKey, peer.label)).toBe(peer.keyId);
    expect(signer.trust(encodeTrustPem(peer), peer.label)).toBe(peer.keyId);
    expect(signer.trustStore()).toContainEqual(exports.exportPublicKey(peer));
    expect(exports.verify({ ...signWith(peer), trustStore: signer.trustStore() }).signature).toBe('valid');
  }));

  it('rejects a peer PQ upgrade without a binding and preserves the Ed25519 entry', () => withSigner(store => {
    const signer = createSigner(store, exports);
    const peer = exports.generateKeyPair('Fictional Peer');
    signer.trust(peer.publicKey, peer.label);
    const before = signer.trustStore();
    const pem = encodeTrustPem(peer).split('-----BEGIN COURTPLUS KEY BINDING-----')[0];
    expect(() => signer.trust(pem, peer.label)).toThrow('The ML-DSA-65 key is not bound to this Ed25519 key');
    expect(signer.trustStore()).toEqual(before);
  }));

  it('keeps both peer PQ keys after importing a rotated binding', () => withSigner(async store => {
    const signer = createSigner(store, exports);
    const oldKey = exports.generateKeyPair('Fictional Office');
    const newKey = { ...oldKey, ...generatePqKeyPair() };
    signer.trust(encodeTrustPem(oldKey), oldKey.label);
    expect(signer.trust(encodeTrustPem(newKey), 'Another label')).toBe(oldKey.keyId);
    signer.trust(encodeTrustPem(oldKey), oldKey.label);

    const trusted = createSigner(store, exports).trustStore();
    expect(trusted).toEqual([exports.exportPublicKey(oldKey), exports.exportPublicKey(newKey)]);
    for (const key of [oldKey, newKey]) {
      const checked = await verifyBundle(signWith(key), exports, trusted, async () => undefined);
      expect(checked).toMatchObject({ signature: 'valid', signatures: { ed25519: true, mldsa65: true } });
    }
  }));

  it.each(['active', 'retired'] as const)('keeps a local %s key independent of an imported PQ key', status => withSigner(store => {
    const { pqPublicKey, pqPrivateKey, pqKeyId, ...local } = exports.generateKeyPair('Fictional Office');
    store.writeSettings({ 'signing-key': JSON.stringify(local) }, 'signer.fixture', {});
    const signer = createSigner(store, exports);
    if (status === 'retired') signer.retire();

    const peer = { ...local, ...generatePqKeyPair() };
    expect(signer.trust(encodeTrustPem(peer), 'Fictional Peer')).toBe(local.keyId);
    expect(signer.trustStore()).toEqual([{ ...exports.exportPublicKey(local), status }]);
  }));

  it('adds the PQ key when a legacy passphrase-protected key is unlocked', () => withSigner(store => {
    const { pqPublicKey, pqPrivateKey, pqKeyId, privateKey, ...legacy } = exports.generateKeyPair('Fictional Office');
    const salt = randomBytes(16);
    const iv = randomBytes(12);
    const derived = scryptSync(passphrase, salt, 32, { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
    const cipher = createCipheriv('aes-256-gcm', derived, iv);
    const ciphertext = Buffer.concat([cipher.update(privateKey, 'utf8'), cipher.final()]);
    const sealed = {
      salt: salt.toString('base64'), iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'), data: ciphertext.toString('base64'),
    };
    store.writeSettings({ 'signing-key': JSON.stringify({ ...legacy, sealed }) }, 'signer.fixture', {});
    const signer = createSigner(store, exports);
    expect(() => signer.unlock('wrong fictional passphrase')).toThrow(/Wrong/);
    expect(signer.publicKey(legacy.label).pqPublicKey).toBeUndefined();
    expect(signer.unlock(passphrase)).toMatchObject({ keyId: legacy.keyId, protected: true, unlocked: true });
    const signingKey = signer.key(legacy.label);
    expect(signingKey.pqPrivateKey).toBeTruthy();
    const saved = store.readSetting('signing-key')!;
    expect(saved).not.toContain(signingKey.pqPrivateKey!);
    signer.lock();
    expect(signer.unlock(passphrase).unlocked).toBe(true);
    expect(signer.key(legacy.label).pqPublicKey).toBe(signingKey.pqPublicKey);
  }));

  it('seals the key under a passphrase and signs only while unlocked', () => withSigner((store, clock) => {
    const signer = createSigner(store, exports, () => clock.now);
    const keyId = signer.key('Fictional Office').keyId;
    expect(() => signer.setPassphrase(undefined, 'short')).toThrow(/at least 12/);
    expect(signer.setPassphrase(undefined, passphrase)).toMatchObject({ keyId, protected: true, unlocked: false });
    expect(store.readSetting('signing-key')).not.toMatch(/PRIVATE KEY/);
    expect(() => signer.key('Fictional Office')).toThrow(/Unlock the signing key/);
    expect(signer.publicKey('Fictional Office').keyId).toBe(keyId);
    expect(() => signer.unlock('wrong fictional passphrase')).toThrow(/Wrong/);
    expect(store.auditEntries().some(entry => entry.action === 'signer.unlock.failed')).toBe(true);
    expect(signer.unlock(passphrase).unlocked).toBe(true);
    expect(signer.key('Fictional Office').keyId).toBe(keyId);
    clock.now += 15 * 60_000 + 1;
    expect(() => signer.key('Fictional Office')).toThrow(/Unlock/);
    // A changed passphrase needs the old one, and the old one stops working.
    expect(() => signer.setPassphrase('wrong fictional passphrase', 'new fictional passphrase')).toThrow(/Wrong/);
    signer.setPassphrase(passphrase, 'new fictional passphrase');
    expect(() => signer.unlock(passphrase)).toThrow(/Wrong/);
    expect(signer.unlock('new fictional passphrase').unlocked).toBe(true);
  }));

  it('retires a key: old drafts still verify, it never signs again, and a new key replaces it', () => withSigner(store => {
    const signer = createSigner(store, exports);
    const old = signer.key('Fictional Office');
    const bundle = signWith(old);
    signer.setPassphrase(undefined, passphrase);
    expect(() => signer.retire()).toThrow(/Wrong/);
    expect(signer.retire(passphrase)).toMatchObject({ keyId: undefined, retired: [old.keyId] });
    expect(signer.trustStore().find(entry => entry.keyId === old.keyId)?.status).toBe('retired');
    expect(exports.verify({ ...bundle, trustStore: signer.trustStore() }).signature).toBe('valid');
    const replacement = signer.key('Fictional Office');
    expect(replacement.keyId).not.toBe(old.keyId);
    expect(signer.status()).toMatchObject({ keyId: replacement.keyId, protected: false, retired: [old.keyId] });
    expect(store.auditEntries().map(entry => entry.action)).toEqual(expect.arrayContaining(['signer.retire', 'signer.create']));
  }));
});
