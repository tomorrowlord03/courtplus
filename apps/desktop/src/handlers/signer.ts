import { createCipheriv, createDecipheriv, createHash, createPrivateKey, createPublicKey, randomBytes, scryptSync } from 'node:crypto';
import type * as Export from '@courtplus/export' with { 'resolution-mode': 'import' };
import type { Store } from '../store';

type SigningKey = Export.SigningKey;
type TrustEntry = Export.TrustEntry;
/** The PKCS#8 PEM sealed with AES-256-GCM under a scrypt key derived from the passphrase. */
type Sealed = { salt: string; iv: string; tag: string; data: string };
type StoredKey = TrustEntry & ({ privateKey: string } | { sealed: Sealed });

const keySetting = 'signing-key';
const retiredSetting = 'retired-signers';
const unlockMs = 15 * 60_000;
// N=2^15 keeps one unlock under ~100 ms on a jail-office laptop while making guessing expensive.
const scryptOptions = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
export const minPassphraseLength = 12;

function derive(passphrase: string, salt: Buffer) {
  return scryptSync(passphrase.normalize('NFC'), salt, 32, scryptOptions);
}

function seal(privateKey: string, passphrase: string): Sealed {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', derive(passphrase, salt), iv);
  const data = Buffer.concat([cipher.update(privateKey, 'utf8'), cipher.final()]);
  return { salt: salt.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
}

function open(sealed: Sealed, passphrase: string): string {
  try {
    const decipher = createDecipheriv('aes-256-gcm', derive(passphrase, Buffer.from(sealed.salt, 'base64')),
      Buffer.from(sealed.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(sealed.tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(sealed.data, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    throw new Error('Wrong signing key passphrase.');
  }
}

function publicEntry({ keyId, publicKey, label, status }: TrustEntry): TrustEntry {
  return { keyId, publicKey, label, status };
}

export function createSigner(store: Store, exports: typeof Export, now: () => number = Date.now) {
  let unlocked: { keyId: string; privateKey: string; until: number } | undefined;

  const stored = (): StoredKey | undefined => {
    const value = store.readSetting(keySetting);
    return value ? JSON.parse(value) as StoredKey : undefined;
  };
  const retired = (): TrustEntry[] => JSON.parse(store.readSetting(retiredSetting) ?? '[]') as TrustEntry[];

  function current(label: string): StoredKey {
    const existing = stored();
    if (existing) return { ...existing, label };
    const generated = exports.generateKeyPair(label);
    store.writeSettings({ [keySetting]: JSON.stringify(generated) }, 'signer.create', { keyId: generated.keyId });
    return generated;
  }

  function privateKeyOf(key: StoredKey): string {
    if ('privateKey' in key) return key.privateKey;
    if (unlocked?.keyId === key.keyId && unlocked.until > now()) return unlocked.privateKey;
    unlocked = undefined;
    throw new Error('Unlock the signing key in Settings before exporting a signed draft.');
  }

  /** The key used to sign. Throws while a passphrase-protected key is locked. */
  function key(label: string): SigningKey {
    const active = current(label);
    return { ...publicEntry(active), privateKey: privateKeyOf(active) };
  }

  /** The public half only; never needs the passphrase. */
  function publicKey(label: string): TrustEntry {
    return publicEntry(current(label));
  }

  function matches(key: TrustEntry, privateKey: string) {
    return createPublicKey(createPrivateKey(privateKey)).equals(createPublicKey(key.publicKey));
  }

  function unlock(passphrase: string) {
    const active = stored();
    if (!active || !('sealed' in active)) throw new Error('The signing key has no passphrase to unlock.');
    let privateKey: string;
    try {
      privateKey = open(active.sealed, passphrase);
    } catch (error) {
      store.audit('signer.unlock.failed', { keyId: active.keyId });
      throw error;
    }
    if (!matches(active, privateKey)) throw new Error('The stored signing key is damaged.');
    unlocked = { keyId: active.keyId, privateKey, until: now() + unlockMs };
    store.audit('signer.unlock', { keyId: active.keyId });
    return status();
  }

  function lock() {
    unlocked = undefined;
    return status();
  }

  /** Sets or changes the passphrase. `current` is required once the key is protected. */
  function setPassphrase(currentPassphrase: string | undefined, next: string) {
    if (next.length < minPassphraseLength) {
      throw new Error('Use a passphrase of at least ' + minPassphraseLength + ' characters.');
    }
    const active = stored() ?? current('');
    const privateKey = 'privateKey' in active ? active.privateKey : open(active.sealed, currentPassphrase ?? '');
    const protectedKey: StoredKey = { ...publicEntry(active), sealed: seal(privateKey, next) };
    store.writeSettings({ [keySetting]: JSON.stringify(protectedKey) }, 'signer.passphrase', { keyId: active.keyId });
    unlocked = undefined;
    return status();
  }

  /**
   * Retires the signing key for good: its public half stays trusted as `retired` so earlier
   * drafts still verify, the private half is discarded, and the next export makes a new key.
   */
  function retire(passphrase?: string) {
    const active = stored();
    if (!active) throw new Error('There is no signing key to retire.');
    if ('sealed' in active) open(active.sealed, passphrase ?? '');
    const entries = [...retired().filter(entry => entry.keyId !== active.keyId), { ...publicEntry(active), status: 'retired' as const }];
    store.writeSettings({ [keySetting]: '', [retiredSetting]: JSON.stringify(entries) }, 'signer.retire', { keyId: active.keyId });
    unlocked = undefined;
    return status();
  }

  function status() {
    const active = stored();
    return {
      keyId: active?.keyId,
      protected: active !== undefined && 'sealed' in active,
      unlocked: unlocked !== undefined && unlocked.keyId === active?.keyId && unlocked.until > now(),
      retired: retired().map(entry => entry.keyId),
    };
  }

  function trustStore(): TrustEntry[] {
    const peers = JSON.parse(store.readSetting('trusted-signers') ?? '[]') as TrustEntry[];
    const active = stored();
    return [...(active ? [publicEntry(active)] : []), ...retired(), ...peers];
  }

  function trust(pem: string, label: string): string {
    if (pem.length > 4096 || !/^-----BEGIN PUBLIC KEY-----/.test(pem)) {
      throw new Error('Choose an Ed25519 public key in PEM format.');
    }
    const parsed = createPublicKey(pem);
    if (parsed.asymmetricKeyType !== 'ed25519') throw new Error('Choose an Ed25519 public key.');
    const publicKey = parsed.export({ type: 'spki', format: 'pem' }).toString();
    const keyId = createHash('sha256').update(parsed.export({ type: 'spki', format: 'der' })).digest('hex');
    if (!trustStore().some(entry => entry.keyId === keyId)) {
      const peers = JSON.parse(store.readSetting('trusted-signers') ?? '[]') as TrustEntry[];
      peers.push({ keyId, publicKey, label, status: 'active' });
      store.writeSettings({ 'trusted-signers': JSON.stringify(peers) }, 'signer.trust', { keyId });
    }
    return keyId;
  }

  return { key, publicKey, unlock, lock, setPassphrase, retire, status, trust, trustStore };
}
