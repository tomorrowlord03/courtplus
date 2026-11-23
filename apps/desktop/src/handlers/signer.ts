import { createHash, createPublicKey } from 'node:crypto';
import type * as Export from '@courtplus/export' with { 'resolution-mode': 'import' };
import type { Store } from '../store';

type SigningKey = Export.SigningKey;
type TrustEntry = Export.TrustEntry;

export function createSigner(store: Store, exports: typeof Export) {
  function key(label: string): SigningKey {
    const setting = 'signing-key';
    const existing = store.readSetting(setting);
    if (existing) return { ...JSON.parse(existing) as SigningKey, label };
    const generated = exports.generateKeyPair(label);
    store.writeSettings({ [setting]: JSON.stringify(generated) }, 'signer.create', { keyId: generated.keyId });
    return generated;
  }

  function trustStore(): TrustEntry[] {
    const peers = JSON.parse(store.readSetting('trusted-signers') ?? '[]') as TrustEntry[];
    const existing = store.readSetting('signing-key');
    if (existing) peers.unshift(exports.exportPublicKey(JSON.parse(existing) as SigningKey));
    return peers;
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

  return { key, trust, trustStore };
}
