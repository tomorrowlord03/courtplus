import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as exports from '@courtplus/export';
import type { ScreeningResult } from '@courtplus/contracts';
import { describe, expect, it } from 'vitest';
import { createSigner } from '../src/handlers/signer';
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
