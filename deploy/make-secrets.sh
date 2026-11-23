#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SECRETS_DIR="${SCRIPT_DIR}/secrets"

if [ "$#" -gt 1 ] || { [ "$#" -eq 1 ] && [ "$1" != rotate-pq ]; }; then
  echo "Usage: $0 [rotate-pq]" >&2
  exit 2
fi

umask 077
mkdir -p "${SECRETS_DIR}"
chmod 700 "${SECRETS_DIR}"

LOCK_DIR="${SECRETS_DIR}/.make-secrets.lock"
if ! mkdir "${LOCK_DIR}"; then
  echo "Cannot lock ${SECRETS_DIR}; if no other make-secrets.sh is running, run: rmdir \"${LOCK_DIR}\"" >&2
  exit 1
fi
trap 'rmdir "${LOCK_DIR}"' EXIT
trap 'exit 1' HUP INT TERM

RETIRED_PUBLIC="${SECRETS_DIR}/pq_retired/public"
mkdir -p "${RETIRED_PUBLIC}"
chmod 755 "${RETIRED_PUBLIC}"

if [ "${1:-}" = rotate-pq ]; then
  cd "${SCRIPT_DIR}/.."
  node --input-type=module - "${SECRETS_DIR}" <<'NODE'
import { createPrivateKey, createPublicKey, randomBytes } from 'node:crypto';
import {
  chmodSync, chownSync, linkSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { encodeTrustPem, generatePqKeyPair, sha256 } from '@courtplus/export/signing';

const dir = process.argv[2];
const activePath = join(dir, 'pq_signing_key');
const oldSeed = readFileSync(activePath, 'utf8').trim();
if (!/^[a-f0-9]{64}$/i.test(oldSeed)) throw new Error('Expected a 32-byte hex seed in pq_signing_key');
const signingPath = join(dir, 'signing_key');
const privateKey = readFileSync(signingPath, 'utf8');
const publicKey = createPublicKey(createPrivateKey(privateKey));
if (publicKey.asymmetricKeyType !== 'ed25519') throw new Error('Expected an Ed25519 key in signing_key');
const pq = generatePqKeyPair(Buffer.from(oldSeed, 'hex'));
const pem = encodeTrustPem({
  ...pq, privateKey, publicKey: publicKey.export({ type: 'spki', format: 'pem' }),
  keyId: sha256(publicKey.export({ type: 'spki', format: 'der' })), status: 'active', label: '',
});

const retiredDir = join(dir, 'pq_retired');
const seedArchive = join(retiredDir, 'seeds');
const publicArchive = join(retiredDir, 'public');
mkdirSync(seedArchive, { recursive: true, mode: 0o700 });
const retiredSeed = join(seedArchive, pq.pqKeyId + '.seed');
const retiredPem = join(publicArchive, pq.pqKeyId + '.pem');
const staged = mkdtempSync(join(dir, '.rotate-pq-'));
try {
  const nextPath = join(staged, 'seed');
  const pemPath = join(staged, 'binding.pem');
  writeFileSync(nextPath, randomBytes(32).toString('hex') + '\n', { flag: 'wx', mode: 0o600 });
  writeFileSync(pemPath, pem, { flag: 'wx', mode: 0o644 });
  // The shell's private umask also applies to the staging file.
  chmodSync(pemPath, 0o644);
  const { uid, gid } = statSync(signingPath);
  for (const path of [nextPath, pemPath, retiredDir, seedArchive, publicArchive]) chownSync(path, uid, gid);
  // Hard links fail if the destination exists. Archive the old seed before replacing the active seed.
  linkSync(activePath, retiredSeed);
  try {
    linkSync(pemPath, retiredPem);
  } catch (error) {
    unlinkSync(retiredSeed);
    throw error;
  }
  try {
    renameSync(nextPath, activePath);
  } catch (error) {
    unlinkSync(retiredPem);
    unlinkSync(retiredSeed);
    throw error;
  }
  console.log('Archived the previous PQ seed in pq_retired/seeds');
  console.log('Published its bound public key in pq_retired/public');
  console.log('Created a new pq_signing_key');
} finally {
  rmSync(staged, { recursive: true, force: true });
}
NODE
  exit
fi

if [ ! -f "${SECRETS_DIR}/evidence_key" ]; then
  openssl rand -hex 32 > "${SECRETS_DIR}/evidence_key"
  chmod 600 "${SECRETS_DIR}/evidence_key"
  echo "Created ${SECRETS_DIR}/evidence_key"
else
  echo "${SECRETS_DIR}/evidence_key already exists, skipping"
fi

if [ ! -f "${SECRETS_DIR}/signing_key" ]; then
  openssl genpkey -algorithm ed25519 -out "${SECRETS_DIR}/signing_key"
  chmod 600 "${SECRETS_DIR}/signing_key"
  echo "Created ${SECRETS_DIR}/signing_key"
else
  echo "${SECRETS_DIR}/signing_key already exists, skipping"
fi

if [ ! -f "${SECRETS_DIR}/db_key" ]; then
  openssl rand -hex 32 > "${SECRETS_DIR}/db_key"
  chmod 600 "${SECRETS_DIR}/db_key"
  echo "Created ${SECRETS_DIR}/db_key"
else
  echo "${SECRETS_DIR}/db_key already exists, skipping"
fi

if [ ! -f "${SECRETS_DIR}/pq_signing_key" ]; then
  openssl rand -hex 32 > "${SECRETS_DIR}/pq_signing_key"
  chmod 600 "${SECRETS_DIR}/pq_signing_key"
  echo "Created ${SECRETS_DIR}/pq_signing_key"
else
  echo "${SECRETS_DIR}/pq_signing_key already exists, skipping"
fi
