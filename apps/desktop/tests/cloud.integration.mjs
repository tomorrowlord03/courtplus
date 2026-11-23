import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import jsQR from 'jsqr';
import { PNG } from 'pngjs';
import { buildApp } from '../../appliance/dist/app.js';
import { addAccount } from '../../appliance/dist/auth.js';
import { openDb } from '../../appliance/dist/db.js';
import { addIssuer } from '../../appliance/dist/receipts.js';
import { createHandlers } from '../dist/handlers/index.js';
import { openStore } from '../dist/store.js';
import { indiaDate } from '../dist/handlers/board.js';

const fixtureSecret = 'fictional integration fixture only';
const repository = fileURLToPath(new URL('../../../', import.meta.url));
const storage = {
  isAsyncEncryptionAvailable: async () => true,
  encryptStringAsync: async value => Buffer.from(value),
  decryptStringAsync: async value => ({ result: value.toString(), shouldReEncrypt: false }),
};

async function until(read) {
  const limit = Date.now() + 10_000;
  while (Date.now() < limit) {
    const value = await read();
    if (value) return value;
    await delay(80);
  }
  assert.fail('Timed out waiting for CourtPlus Cloud sync');
}

test('desktop bearer login, private projection, card sync, handoff SSE and public QR receipt', { timeout: 40_000 }, async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'courtplus-cloud-test-'));
  const keyPath = join(scratch, 'db-key');
  await writeFile(keyPath, randomBytes(32).toString('hex'));
  const cloudDb = openDb(join(scratch, 'cloud.sqlite3'), keyPath);
  const desktop = await openStore(scratch, storage);
  let app;
  let cloud;
  let qrUrl;
  try {
    app = await buildApp({ db: cloudDb, origin: 'https://localhost', tickMs: 100 });
    await addAccount(cloudDb, 'fictional-jail', fixtureSecret, 'superintendent');
    await addAccount(cloudDb, 'fictional-dlsa', fixtureSecret, 'dlsa');
    const origin = await app.listen({ host: '127.0.0.1', port: 0 });
    desktop.writeSettings({ backendUrl: origin });
    const { handlers, signer, cloud: client } = await createHandlers(desktop, {
      resourceDirectory: repository,
      boardChanged: () => undefined,
      folder: async () => scratch, savePath: async () => undefined,
      print: async html => {
        const qr = html.match(/src="data:image\/png;base64,([A-Za-z0-9+/=]+)"/);
        assert.ok(qr);
        const { data, width, height } = PNG.sync.read(Buffer.from(qr[1], 'base64'));
        qrUrl = jsQR(new Uint8ClampedArray(data), width, height)?.data;
        return Buffer.from('%PDF-1.7 fictional test PDF');
      },
    });
    cloud = client;
    const key = signer.key('CourtPlus Desktop');
    addIssuer(cloudDb, key.label, key.publicKey);
    const person = {
      id: 'fictional-private-person-id', alias: 'Fictional private alias', prisonerType: 'undertrial',
      priorConviction: 'unknown', otherHolds: 'unknown', caseIds: [],
    };
    const record = {
      id: 'fictional-private-case-id', personId: person.id, caseNo: 'fictional-private-case-number',
      court: 'Fictional private court', charges: [], pendingStatus: 'trial',
      custody: [{ kind: 'judicial', start: '2024-01-01', ongoing: true }], events: [],
    };
    await handlers.saveCase(person, record);
    await cloud.login('fictional-jail', fixtureSecret);

    async function post(path, data, token) {
      const response = await fetch(origin + path, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(token && { authorization: 'Bearer ' + token }) },
        body: JSON.stringify(data),
      });
      const text = await response.text();
      assert.ok(response.ok, String(response.status) + ' ' + text);
      return text ? JSON.parse(text) : undefined;
    }
    const dlsa = await post('/api/auth/login', { username: 'fictional-dlsa', password: fixtureSecret, client: 'desktop' });
    const remote = await until(async () => (await post('/api/listCases', [], dlsa.token))[0]);
    assert.notEqual(remote.id, record.id);
    assert.equal(remote.caseNo, undefined);
    assert.equal(remote.court, undefined);
    assert.equal(await handlers.role(), 'superintendent');
    const today = indiaDate();
    const card = (await handlers.board(today)).find(card => card.lane === 'LAWYER_REVIEW');
    await handlers.updateCard(card.id, { state: 'assigned' });
    await until(async () => (await post('/api/board', [today], dlsa.token))
      .some(card => card.caseId === remote.id && card.state === 'assigned'));

    await post('/api/handoff', { caseId: remote.id, kind: 'release_order', orderOn: today }, dlsa.token);
    const handoff = await until(async () => (await handlers.board(today)).find(card => card.id.startsWith('handoff:')));
    assert.equal(handoff.caseId, record.id);
    assert.equal(handoff.state, 'order_verified');
    await handlers.updateCard(handoff.id, { state: 'jail_acknowledged' });
    await until(async () => (await handlers.board(today))
      .some(card => card.id === handoff.id && card.state === 'jail_acknowledged'));

    const bundle = await handlers.exportDraft('RIGHTS_CARD', record.id, 'en');
    const receipt = await readFile(bundle.receiptPath, 'utf8');
    const { receiptId } = JSON.parse(receipt).payload;
    assert.equal(qrUrl, origin + '/v/' + receiptId);
    const publicPage = await fetch(qrUrl);
    assert.equal(publicPage.status, 200);
    assert.match(await publicPage.text(), /Signature<\/dt><dd>Valid/);
    assert.equal((await handlers.verify({
      pdf: await readFile(bundle.pdfPath), receipt, manifest: await readFile(bundle.manifestPath, 'utf8'),
    })).signature, 'valid');
    await cloud.signOut();
    assert.equal(await handlers.role(), 'legal_aid');
  } finally {
    cloud?.disconnect();
    await app?.close();
    desktop.close();
    cloudDb.close();
    await rm(scratch, { recursive: true, force: true });
  }
});
