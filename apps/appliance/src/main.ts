import { readFileSync } from 'node:fs';
import { addAccount } from './auth.js';
import { buildApp } from './app.js';
import { openDb, verifyAudit } from './db.js';
import { parse } from './http.js';
import { password, roles, username } from './inputs.js';
import { addIssuer } from './receipts.js';

const path = process.env.COURTPLUS_DB_PATH ?? '/var/lib/courtplus/courtplus.sqlite3';
const key = process.env.COURTPLUS_DB_KEY_FILE ?? '/run/secrets/db_key';
const db = openDb(path, key);
const [command, ...args] = process.argv.slice(2);

try {
  if (command === 'create-account') {
    if (args.length !== 2) throw new Error('Usage: create-account USERNAME ROLE < password');
    const [user, role] = args;
    await addAccount(db, parse(username, user), parse(password, readFileSync(0, 'utf8').replace(/\r?\n$/, '')), parse(roles, role));
    console.log('Account created.');
  } else if (command === 'trust-issuer') {
    if (args.length !== 1) throw new Error('Usage: trust-issuer "Office name" < public-key.pem');
    console.log('Trusted key ' + addIssuer(db, args[0], readFileSync(0, 'utf8')));
  } else if (command === 'verify-audit') {
    const result = verifyAudit(db);
    console.log(JSON.stringify(result));
    if (!result.valid) process.exitCode = 1;
  } else if (command === undefined) {
    const origin = process.env.APP_ORIGIN ?? 'https://localhost';
    const url = new URL(origin);
    const minutes = Number(process.env.COURTPLUS_HANDOFF_MINUTES ?? '60');
    if (url.origin !== origin || url.protocol !== 'https:') throw new Error('APP_ORIGIN must be a canonical HTTPS origin');
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 10080) throw new Error('Invalid handoff time limit');
    const app = await buildApp({
      db, origin, logger: true, handoffDueMs: minutes * 60_000,
      signingKeyFile: process.env.COURTPLUS_SIGNING_KEY_FILE,
      office: process.env.COURTPLUS_ISSUING_OFFICE,
      prison: process.env.COURTPLUS_PRISON,
      district: process.env.COURTPLUS_DISTRICT,
    });
    app.addHook('onClose', async () => { db.close(); });
    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
      process.once(signal, () => void app.close().catch(() => { process.exitCode = 1; }));
    }
    await app.listen({ port: 3000, host: '0.0.0.0' });
  } else {
    throw new Error('Unknown CourtPlus Cloud command');
  }
} finally {
  if (command !== undefined) db.close();
}
