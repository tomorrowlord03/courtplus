# CourtPlus Cloud Deployment Secrets

## Overview

CourtPlus Cloud requires persistent encryption and signing secrets for production operation:
- `evidence_key`: 64 hex characters (32 bytes AES-256-GCM encryption key). Used to encrypt all stored electronic evidence at rest.
- `signing_key`: Ed25519 private key in PEM format (unencrypted). Used to cryptographically sign digital evidence receipts under the Bharatiya Sakshya Adhiniyam, 2023 (BSA Section 63).
- `db_key`: 64 hex characters (32 bytes SQLCipher database encryption key).

## Generating Secrets

Use the idempotent `make-secrets.sh` script to generate secrets inside `deploy/secrets/`:

```bash
chmod +x deploy/make-secrets.sh
./deploy/make-secrets.sh
```

This creates:
- `secrets/evidence_key` with `openssl rand -hex 32` (`chmod 600`)
- `secrets/signing_key` with `openssl genpkey -algorithm ed25519` (`chmod 600`)
- `secrets/db_key` with `openssl rand -hex 32` (`chmod 600`)

If any of these secret files already exist, the script skips generation to preserve existing keys.

With the repository dependencies installed and `npm run build -w @courtplus/export` complete, stop the appliance and run `sudo -u ubuntu bash deploy/make-secrets.sh rotate-pq` for the default secret paths.
Run `rotate-pq` once per rotation. Re-running it rotates the key again.
Keep the Ed25519 key in place. The command archives the old seed under `secrets/pq_retired/seeds` and its bound public PEM under `secrets/pq_retired/public`. Back up the public PEMs to keep old receipts verifiable.
Recreate the appliance container to mount the new seed and the read-only public directory. For other deployments, set `COURTPLUS_PQ_RETIRED_DIR` to the directory of bound public PEMs.

The draft signing overlay shares the evidence ML-DSA-65 seed and configures `draft_signing_key` as the Ed25519 key. The rotation command produces retired PEMs bound to `secrets/signing_key`. Verifying older receipts issued under `draft_signing_key` requires retired PEMs bound to that key.

## CRITICAL BACKUP WARNING

> [!CAUTION]
> **ALWAYS BACK UP BOTH `secrets/evidence_key` AND `secrets/signing_key` TO DURABLE SECURE STORAGE!**
> - **Losing `evidence_key` makes all stored evidence in the vault permanently unreadable and unrecoverable.** In Docker, falling back to ephemeral or temp storage means restarts or container recreation wipe access to every uploaded evidence file.
> - **Losing `signing_key` prevents verification of previously issued receipts after a container restart or deployment update.**

## Docker Secrets Mounting

In `deploy/docker-compose.yml`, Docker secrets mount the keys read-only into `/run/secrets/`:
- `secrets/evidence_key` -> `/run/secrets/evidence_key` (configured via `COURTPLUS_EVIDENCE_KEY_FILE`)
- `secrets/signing_key` -> `/run/secrets/signing_key` (configured via `COURTPLUS_SIGNING_KEY_FILE`)
- `secrets/db_key` -> `/run/secrets/db_key`

## Production Fail-Fast

When `NODE_ENV=production`, CourtPlus Cloud enforces fail-fast startup checks. If neither a valid evidence key (`COURTPLUS_EVIDENCE_KEY` or `COURTPLUS_EVIDENCE_KEY_FILE`) nor a valid signing key file (`COURTPLUS_SIGNING_KEY_FILE` or `signingKeyFile` option) is available, the server halts immediately with an error rather than falling back to in-memory or temporary keys.
