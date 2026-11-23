#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SECRETS_DIR="${SCRIPT_DIR}/secrets"

mkdir -p "${SECRETS_DIR}"
chmod 700 "${SECRETS_DIR}"

umask 077

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
