import { createCipheriv, createDecipheriv, createPrivateKey, createPublicKey, randomBytes, scryptSync } from 'node:crypto';
import type * as Export from '@courtplus/export' with { 'resolution-mode': 'import' };
import type { Store } from '../store';

type SigningKey = Export.SigningKey;
type TrustEntry = Export.TrustEntry;
type PrivateKeys = Pick<SigningKey, 'privateKey' | 'pqPrivateKey'>;
const signing: typeof import('@courtplus/export/signing', { with: { 'resolution-mode': 'import' } }) =
  require('@courtplus/export/signing');
/** Private keys sealed with AES-256-GCM under a scrypt key derived from the passphrase. */
type Sealed = { salt: string; iv: string; tag: string; data: string };
type StoredKey = SigningKey | (TrustEntry & { sealed: Sealed });

const keySetting = 'signing-key';
const retiredSetting = 'retired-signers';
const unlockMs = 15 * 60_000;
// N=2^15 keeps one unlock under ~100 ms on a jail-office laptop while making guessing expensive.
const scryptOptions = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
export const minPassphraseLength = 12;

function derive(passphrase: string, salt: Buffer) {
  return scryptSync(passphrase.normalize('NFC'), salt, 32, scryptOptions);
}

function seal(keys: PrivateKeys, passphrase: string): Sealed {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', derive(passphrase, salt), iv);
  const { privateKey, pqPrivateKey } = keys;
  const data = Buffer.concat([cipher.update(JSON.stringify({ privateKey, pqPrivateKey }), 'utf8'), cipher.final()]);
  return { salt: salt.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
}

function open(sealed: Sealed, passphrase: string): PrivateKeys {
  try {
    const decipher = createDecipheriv('aes-256-gcm', derive(passphrase, Buffer.from(sealed.salt, 'base64')),
      Buffer.from(sealed.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(sealed.tag, 'base64'));
    const text = Buffer.concat([decipher.update(Buffer.from(sealed.data, 'base64')), decipher.final()]).toString('utf8');
    return text.startsWith('{') ? JSON.parse(text) as PrivateKeys : { privateKey: text };
  } catch {
    throw new Error('Wrong signing key passphrase.');
  }
}

const publicEntry = signing.exportPublicKey;

export function createSigner(store: Store, exports: typeof Export, now: () => number = Date.now) {
  let unlocked: { keyId: string; keys: PrivateKeys; until: number } | undefined;

  const stored = (): StoredKey | undefined => {
    const value = store.readSetting(keySetting);
    return value ? JSON.parse(value) as StoredKey : undefined;
  };
  const retired = (): TrustEntry[] => JSON.parse(store.readSetting(retiredSetting) ?? '[]') as TrustEntry[];

  function current(label: string): StoredKey {
    const existing = stored();
    if (existing) {
      if ('sealed' in existing) return { ...existing, label };
      const upgraded = signing.upgradeSigningKey(existing);
      if (upgraded !== existing) saveUpgrade(upgraded);
      return { ...upgraded, label };
    }
    const generated = exports.generateKeyPair(label);
    store.writeSettings({ [keySetting]: JSON.stringify(generated) }, 'signer.create', { keyId: generated.keyId });
    return generated;
  }

  function saveUpgrade(key: StoredKey) {
    store.writeSettings({ [keySetting]: JSON.stringify(key) }, 'signer.upgrade', { keyId: key.keyId });
  }

  function privateKeysOf(key: StoredKey): PrivateKeys {
    if ('privateKey' in key) return { privateKey: key.privateKey, pqPrivateKey: key.pqPrivateKey };
    if (unlocked?.keyId === key.keyId && unlocked.until > now()) return unlocked.keys;
    unlocked = undefined;
    throw new Error('Unlock the signing key in Settings before exporting a signed draft.');
  }

  /** The key used to sign. Throws while a passphrase-protected key is locked. */
  function key(label: string): SigningKey {
    const active = current(label);
    return { ...publicEntry(active), ...privateKeysOf(active) };
  }

  /** The public half only; never needs the passphrase. */
  function publicKey(label: string): TrustEntry {
    const active = current(label);
    if ('privateKey' in active || active.binding) {
      return { ...publicEntry(active), publicKey: signing.encodeTrustPem(active) };
    }
    // A pre-binding sealed key can export its Ed25519 key until it is unlocked.
    const { pqPublicKey, ...ed25519 } = active;
    return publicEntry(ed25519);
  }

  function matches(key: TrustEntry, privateKey: string) {
    return createPublicKey(createPrivateKey(privateKey)).equals(createPublicKey(key.publicKey));
  }

  function unlock(passphrase: string) {
    const active = stored();
    if (!active || !('sealed' in active)) throw new Error('The signing key has no passphrase to unlock.');
    let keys: PrivateKeys;
    try {
      keys = open(active.sealed, passphrase);
    } catch (error) {
      store.audit('signer.unlock.failed', { keyId: active.keyId });
      throw error;
    }
    if (!matches(active, keys.privateKey)) throw new Error('The stored signing key is damaged.');
    const upgraded = signing.upgradeSigningKey({ ...publicEntry(active), ...keys });
    if (!active.binding) {
      saveUpgrade({
        ...publicEntry(upgraded), binding: signing.keyBinding(upgraded),
        sealed: active.pqPublicKey ? active.sealed : seal(upgraded, passphrase),
      });
    }
    unlocked = {
      keyId: active.keyId, keys: { privateKey: upgraded.privateKey, pqPrivateKey: upgraded.pqPrivateKey }, until: now() + unlockMs,
    };
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
    const keys = 'privateKey' in active ? active : open(active.sealed, currentPassphrase ?? '');
    const upgraded = signing.upgradeSigningKey({ ...publicEntry(active), ...keys });
    const protectedKey: StoredKey = {
      ...publicEntry(upgraded), binding: signing.keyBinding(upgraded), sealed: seal(upgraded, next),
    };
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

  const trustedPeers = (): TrustEntry[] => JSON.parse(store.readSetting('trusted-signers') ?? '[]') as TrustEntry[];

  function localEntries(): TrustEntry[] {
    const active = stored();
    return [...(active ? [publicEntry(active)] : []), ...retired().map(publicEntry)];
  }

  function trustStore(): TrustEntry[] {
    const local = localEntries();
    const peers = trustedPeers().filter(peer => !local.some(entry => entry.keyId === peer.keyId));
    return [...local, ...peers.map(peer => {
      // Entries imported before bindings remain trusted for Ed25519 only.
      const { pqPublicKey, ...ed25519 } = peer;
      return publicEntry(peer.binding ? peer : ed25519);
    })];
  }

  function trust(pem: string, label: string): string {
    const entry = signing.decodeTrustPem(pem);
    const { keyId, pqKeyId } = entry;
    if (localEntries().some(local => local.keyId === keyId)) return keyId;
    const peers = trustedPeers();
    const existing = peers.find(peer => peer.keyId === keyId);
    if (existing && (!pqKeyId || peers.some(peer => peer.keyId === keyId && peer.binding && peer.pqKeyId === pqKeyId))) return keyId;

    const updated = [...peers.filter(peer => peer.keyId !== keyId || peer.binding), {
      ...entry, label: existing?.label ?? label, status: existing?.status ?? 'active',
    }];
    store.writeSettings({ 'trusted-signers': JSON.stringify(updated) }, 'signer.trust', { keyId });
    return keyId;
  }

  return { key, publicKey, unlock, lock, setPassphrase, retire, status, trust, trustStore };
}
