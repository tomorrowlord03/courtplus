# CourtPlus Cloud

This Fastify service owns the encrypted, anonymised shared case store, jail and DLSA handoff board, and public signed-draft verification. The checked-out branch can run with the contracts and rules engine. When present, Docker builds and serves **apps/ui/dist** and uses **@courtplus/export** for cloud draft and return generation. **@courtplus/intake** runs on the laptop.

## Run locally

From the repository root with Docker Desktop running and ports 80 and 443 available, create a development secret once. These PowerShell commands write the secret under the ignored deployment directory.

```powershell
New-Item -ItemType Directory -Force deploy/secrets | Out-Null
if (-not (Test-Path deploy/secrets/db_key)) {
  node -e "require('node:fs').writeFileSync('deploy/secrets/db_key', require('node:crypto').randomBytes(32).toString('hex') + '\n', { flag: 'wx', mode: 0o600 })"
}
docker build --target test -f deploy/Dockerfile -t courtplus-cloud:test .
docker compose -f deploy/docker-compose.yml build
docker compose -f deploy/docker-compose.yml up -d --wait
docker compose -f deploy/docker-compose.yml cp caddy:/data/caddy/pki/authorities/local/root.crt deploy/localhost.crt
curl.exe -I http://localhost/health
curl.exe --ssl-no-revoke --cacert deploy/localhost.crt https://localhost/health
```

Caddy redirects localhost HTTP to internally signed HTTPS. Use the exported local CA on this machine for local browser trust. Create accounts using the same stdin procedure as in the [AWS guide](../../deploy/aws/README.md). Smoke uses a case already in the store, posts a release handoff and acknowledges it as the superintendent. Use dedicated test accounts and an isolated stack when using the fictional fixture in **tests/smoke-case.json**.

For the fictional fixture, use the test DLSA account to send the contents of **tests/smoke-case.json** to **POST /api/saveCase** before running smoke. Use the returned desktop bearer token or the web session cookie and its CSRF token. The fixture's case ID is **c990002**.

```powershell
./deploy/smoke.ps1 -CaFile deploy/localhost.crt -CaseId YOUR_CASE_ID -DlsaUser YOUR_DLSA_USER -JailUser YOUR_JAIL_USER
```

## HTTP and client integration

| Route | Behavior |
| --- | --- |
| POST /api/auth/login | JSON object with username, password and client. Web gets a Secure SameSite session cookie and CSRF token. Use client desktop for a 15-minute bearer token. |
| GET /api/auth/session | Get the authenticated role and, for cookie sessions, the CSRF token. Send X-CSRF-Token for writes with cookies. |
| POST /api/auth/logout | Revoke the session. |
| POST /api/auth/revoke-sessions | Admin revokes all cookie and bearer sessions for a username. Send a JSON object with username and the usual CSRF token for cookie requests. |
| POST /api/{method} | Send the positional argument array from CourtPlusApi. Encode bytes as an object containing a single $base64 property with standard padded base64. |
| GET /api/handoff | Current handoffs for authenticated users. |
| POST /api/handoff | DLSA posts a caseId, kind (release_order, bail_granted, acquitted), and orderOn. Repeating the same combination returns the existing handoff. |
| GET /api/handoff/stream | Authenticated SSE. Initial snapshot, then posted, overdue and acknowledged. Last-Event-ID replays recent updates. |
| POST /api/handoff/{id}/ack | Superintendent records receipt. Repeating returns the same acknowledgement. |
| POST /api/cases/{caseId}/application-filed | Superintendent records filedOn as a civil date. |
| POST /api/receipts | Editors publish a signed receipt and manifest as strings. Returns a public HTTPS URL. |
| POST /api/receipts/{receiptId}/withdraw | Admin withdraws a published receipt. |
| POST /api/verify-digest | Check a draft using its SHA-256 fingerprint, signed receipt and manifest. The web client computes the fingerprint on the device. |
| POST /api/verify | Check a draft from base64-encoded PDF bytes, limited to 4 MiB decoded. Use the digest route for larger drafts. |
| GET /v/{receiptId} | Public metadata and live signature verification using the enrolled office key. |

Case imports must use anonymised aliases such as **Accused-07** and generated opaque IDs for people, cases and documents. The service validates the cloud subset and drops identifying optional fields from the shared contract, including quotes, notes, court, police station, and court or FIR reference numbers. Generated PDFs and reports are available to the requesting account for up to ten minutes. The API verifies a signed draft bundle without storing its PDF. Use the desktop for original order intake and AI-assistance notes. Both depend on local provenance, and the HTTP methods return explicit desktop-only errors.

Overdue escalations appear on the live handoff board for both offices and in the audit chain. The interval defaults to one hour. The service preserves escalation and acknowledgement timestamps independently. After acknowledging receipt, the superintendent can mark holds checked and close the handoff card on the action board. The shared CourtPlusApi role method maps UTRC members and admins to the existing utrc view. The real role is available from the session endpoint.

Client integration remaining outside this workspace includes using cloud login and its bearer token from the Electron app and placing the publication URL into desktop-generated draft QR codes. The cloud serves the existing Vite UI with a same-origin session adapter and a separate live handoff screen.

The cloud runs Chromium as the unprivileged application user. The Docker host must permit unprivileged user namespaces for the cloud container. The bundled [seccomp profile](../../deploy/chromium-seccomp.json) derives from the [Moby profile at 245180c](https://github.com/moby/profiles/blob/245180c/seccomp/default.json) with additional rules for Chromium's namespace sandbox. Keep the profile next to the Compose file when transferring a release.

After building the image, run `node deploy/security-smoke.mjs` from the repository root. The smoke test uses an isolated Compose project, starts both services, and checks HTTPS, PDF rendering and the container limits.
