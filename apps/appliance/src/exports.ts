import { execFile } from 'node:child_process';
import { createPrivateKey, createPublicKey, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import type { CaseRecord, CourtPlusApi, Person, ScreeningResult } from '@courtplus/contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { toDataURL } from 'qrcode';
import type { Options } from './app.js';
import type { Session } from './auth.js';
import { indiaDate, type Cases } from './cases.js';
import { audit, sha256 } from './db.js';
import { HttpError, missingFeature, requireValue } from './http.js';
import type { Receipts } from './receipts.js';

type DraftKind = Exclude<Parameters<CourtPlusApi['exportDraft']>[0], 'AI_ASSISTANCE_NOTE'>;
type DocumentData = {
  S479_3_APPLICATION: { person: Person; caseRecord: CaseRecord; prison: string; result: ScreeningResult };
  DLSA_7_DAY: { person: Person; caseRecord: CaseRecord & { bailGrantedOn: string }; prison: string; district: string; custodyCheckedOn: string };
  RIGHTS_CARD: { dlsaName: string };
};
type SigningKey = { keyId: string; label: string; status: 'active'; privateKey: string; publicKey: string };
type ReturnRow = {
  prison: string; prisonerAlias: string; crimeNumberAndSections: string; admissionOn?: string;
  totalCustodyDays: number; maximumSentence?: string; releasedOn?: string; prisonApplicationToCourtOn?: string;
};

// These are the w7 entry points needed by the cloud until the optional workspace is merged.
type ExportModule = {
  renderHtml<K extends DraftKind>(kind: K, data: DocumentData[K], lang: string): string;
  createReceipt(input: { issuer: string; inputs: unknown; result: ScreeningResult }, key: SigningKey): { receiptId: string; receipt: string };
  createManifest(pdf: Uint8Array, receipt: string, key: SigningKey): string;
  renderScReturnCsv(rows: ReturnRow[]): string;
  renderScReturnXlsx(rows: ReturnRow[]): Promise<Uint8Array>;
};
async function loadExport(): Promise<ExportModule | undefined> {
  let path: string;
  try {
    path = createRequire(import.meta.url).resolve('@courtplus/export');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'MODULE_NOT_FOUND') return undefined;
    throw error;
  }
  return await import(pathToFileURL(path).href) as ExportModule;
}

async function loadKey(file: string, office: string): Promise<SigningKey> {
  const privateKey = await readFile(file, 'utf8');
  const key = createPublicKey(createPrivateKey(privateKey));
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('The draft signing secret must be an Ed25519 private key');
  return {
    privateKey, publicKey: key.export({ type: 'spki', format: 'pem' }).toString(),
    keyId: sha256(key.export({ type: 'spki', format: 'der' })), status: 'active', label: office,
  };
}

const run = promisify(execFile);
const printPolicy = '<meta http-equiv="Content-Security-Policy" content="default-src \'none\';'
  + " style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'\">";

export async function printDraft(html: string): Promise<Buffer> {
  const document = html.replace(/<head(?:\s[^>]*)?>/i, head => head + printPolicy);
  if (document === html) throw new Error('PDF template must include an HTML head');
  const directory = await mkdtemp(join(tmpdir(), 'courtplus-print-'));
  const page = join(directory, 'draft.html');
  const pdf = join(directory, 'draft.pdf');
  try {
    await writeFile(page, document, { mode: 0o600 });
    await run('chromium', [
      '--headless', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--disable-background-networking',
      '--disable-javascript', '--disable-local-storage', '--disable-extensions', '--no-first-run', '--no-pdf-header-footer',
      '--disk-cache-size=1',
      '--user-data-dir=' + join(directory, 'profile'), '--print-to-pdf=' + pdf, page,
    ], {
      timeout: 25_000, cwd: directory,
      env: { PATH: '/usr/bin:/bin', HOME: directory, TMPDIR: directory, XDG_CONFIG_HOME: directory, XDG_CACHE_HOME: directory },
    });
    return await readFile(pdf);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

type File = { name: string; data: Buffer; type: string };
const retentionMs = 10 * 60_000;
const maxBytes = 24 * 1024 * 1024;
const maxAccountBytes = maxBytes / 2;
const pdfType = 'application/pdf';
const jsonType = 'application/json';
function output(name: string, type: string, data: string | Uint8Array): File {
  if (typeof data === 'string') return { name, type, data: Buffer.from(data, 'utf8') };
  return { name, type, data: Buffer.isBuffer(data) ? data : Buffer.from(data) };
}

export function createExportCache(now = Date.now) {
  const files = new Map<string, { actor: string; expiry: number; files: File[]; bytes: number }>();
  const accounts = new Map<string, number>();
  let totalBytes = 0;

  function expire() {
    const at = now();
    for (const [key, entry] of files) {
      if (entry.expiry > at) continue;
      files.delete(key);
      totalBytes -= entry.bytes;
      const remaining = (accounts.get(entry.actor) ?? 0) - entry.bytes;
      if (remaining) accounts.set(entry.actor, remaining);
      else accounts.delete(entry.actor);
    }
  }

  function store(actor: string, contents: File[], record: () => void): string[] {
    const bytes = contents.reduce((sum, item) => sum + item.data.byteLength, 0);
    if (bytes > maxAccountBytes) throw new HttpError(413, 'EXPORT_TOO_LARGE');
    expire();
    const accountBytes = (accounts.get(actor) ?? 0) + bytes;
    if (accountBytes > maxAccountBytes) throw new HttpError(429, 'ACCOUNT_EXPORT_CAPACITY');
    if (totalBytes + bytes > maxBytes) throw new HttpError(503, 'EXPORT_CAPACITY');
    const key = randomUUID();
    record();
    totalBytes += bytes;
    accounts.set(actor, accountBytes);
    files.set(key, { actor, files: contents, bytes, expiry: now() + retentionMs });
    return contents.map(file => '/api/files/' + key + '/' + file.name);
  }

  return {
    store, expire,
    get(actor: string, id: string, name: string) {
      expire();
      const entry = files.get(id);
      return entry?.actor === actor ? entry.files.find(file => file.name === name) : undefined;
    },
    close() {
      files.clear();
      accounts.clear();
      totalBytes = 0;
    },
  };
}

export async function exportRoutes(
  app: FastifyInstance, options: Options, cases: Cases, receipts: Receipts,
  authenticate: (request: FastifyRequest) => Session,
) {
  const { db, office, prison = '', district = '', signingKeyFile, origin, now = Date.now } = options;
  const exporter = await loadExport();
  const signingKey = signingKeyFile && office ? await loadKey(signingKeyFile, office) : undefined;
  const cache = createExportCache();
  let printing = false;
  const timer = setInterval(cache.expire, 60_000).unref();
  app.addHook('onClose', async () => { clearInterval(timer); cache.close(); });

  app.get<{ Params: { id: string; name: string } }>('/api/files/:id/:name', async (request, reply) => {
    const actor = authenticate(request);
    const file = requireValue(cache.get(actor.id, request.params.id, request.params.name));
    return reply.type(file.type).header('content-disposition', 'attachment; filename="' + file.name + '"').send(file.data);
  });

  function render(module: ExportModule, kind: DraftKind, lang: string, related: ReturnType<Cases['context']>, result: ScreeningResult) {
    const { record, person } = related;
    if (kind === 'RIGHTS_CARD') return module.renderHtml(kind, { dlsaName: office ?? '' }, lang);
    if (!prison || kind === 'DLSA_7_DAY' && !district) throw new HttpError(501, 'DRAFT_OFFICE_UNCONFIGURED');
    if (kind === 'S479_3_APPLICATION') return module.renderHtml(kind, { caseRecord: record, person, prison, result }, lang);
    const bailGrantedOn = record.bailGrantedOn;
    if (!bailGrantedOn) throw new HttpError(422, 'BAIL_GRANT_REQUIRED');
    return module.renderHtml(kind, {
      person, caseRecord: { ...record, bailGrantedOn }, prison, district, custodyCheckedOn: result.asOf,
    }, lang);
  }

  return {
    async draft(user: Session, kind: Parameters<CourtPlusApi['exportDraft']>[0], caseId: string, lang: string) {
      if (kind === 'AI_ASSISTANCE_NOTE') return missingFeature('AI_ASSISTANCE_NOTE_ON_DESKTOP');
      if (!exporter) return missingFeature('EXPORT_WORKSPACE_UNAVAILABLE');
      if (!office || !signingKey) return missingFeature('DRAFT_SIGNER_UNCONFIGURED');
      const related = cases.context(caseId);
      const result = cases.screening(caseId, indiaDate(now()));
      const body = render(exporter, kind, lang, related, result);
      if (printing) throw new HttpError(429, 'PRINTER_BUSY');
      printing = true;
      try {
        const { receiptId, receipt } = exporter.createReceipt({ issuer: office, inputs: { person: related.person, record: related.record, kind, lang }, result }, signingKey);
        const link = origin + '/v/' + receiptId;
        const qr = await toDataURL(link, { width: 200, errorCorrectionLevel: 'M' });
        const pdf = await printDraft(body.replace('</main>', '<p><img width="120" height="120" alt="Verify draft" src="' + qr + '">' +
          '<br><a href="' + link + '">' + link + '</a></p></main>'));
        const manifest = exporter.createManifest(pdf, receipt, signingKey);
        const [pdfPath, receiptPath, manifestPath] = cache.store(user.id, [
          output(receiptId + '.pdf', pdfType, pdf), output(receiptId + '.receipt', jsonType, receipt),
          output(receiptId + '.manifest', jsonType, manifest),
        ], () => receipts.publish({ receipt, manifest }, user.id));
        return { pdfPath, receiptPath, manifestPath };
      } finally {
        printing = false;
      }
    },
    async return(user: Session, asOf: string, format: 'csv' | 'xlsx') {
      if (!exporter) return missingFeature('EXPORT_WORKSPACE_UNAVAILABLE');
      const filings = new Map(cases.filings().map(row => [row.case_id, row.filed_on]));
      const records = cases.listCases();
      const people = new Map(cases.listPersons(records).map(person => [person.id, person]));
      const rows = records.filter(record => !record.orderDate || record.orderDate <= asOf).map(record => {
        const person = requireValue(people.get(record.personId));
        const result = cases.screening(record.id, asOf);
        const filed = filings.get(record.id);
        return {
          prison, prisonerAlias: person.alias,
          crimeNumberAndSections: record.charges.map(charge => charge.act + ' ' + charge.section).join(', '),
          admissionOn: record.firstRemandOn && record.firstRemandOn <= asOf ? record.firstRemandOn : undefined,
          maximumSentence: result.maxTermDays === undefined ? undefined : result.maxTermDays + ' days',
          totalCustodyDays: result.rawCustodyDays,
          prisonApplicationToCourtOn: filed && filed <= asOf ? filed : undefined,
          releasedOn: record.releasedOn && record.releasedOn <= asOf ? record.releasedOn : undefined,
        };
      });
      const file = format === 'csv'
        ? output('sc-return.csv', 'text/csv; charset=utf-8', exporter.renderScReturnCsv(rows))
        : output('sc-return.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', await exporter.renderScReturnXlsx(rows));
      return cache.store(user.id, [file], () =>
        db.transaction(() => audit(db, user.id, 'return.export', { asOf, format, rows: rows.length })).immediate())[0];
    },
  };
}
