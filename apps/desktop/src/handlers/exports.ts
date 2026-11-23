import { createHash } from 'node:crypto';
import { mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CaseRecord, CourtPlusApi, Person } from '@courtplus/contracts' with { 'resolution-mode': 'import' };
import type * as Engine from '@courtplus/engine' with { 'resolution-mode': 'import' };
import type * as Export from '@courtplus/export' with { 'resolution-mode': 'import' };
import QRCode from 'qrcode';
import type { Store } from '../store';
import { indiaDate } from './board';
import type { createCloud } from './cloud';
import { readProfile, readSettings } from './settings';
import { createSigner } from './signer';

interface ExportPorts {
  folder: () => Promise<string | undefined>;
  savePath: (filename: string) => Promise<string | undefined>;
  print: (html: string) => Promise<Uint8Array>;
  localizationRoot?: string;
}
type Context = { person: Person; record: CaseRecord; cases: CaseRecord[] };
type Cloud = ReturnType<typeof createCloud>;

async function saveBundle(
  directory: string, name: string, files: Record<string, Uint8Array | string>, publish: () => Promise<void>,
) {
  const temporary = await mkdtemp(join(directory, '.courtplus-draft-'));
  const saved: string[] = [];
  try {
    for (const [extension, contents] of Object.entries(files)) {
      await writeFile(join(temporary, name + extension), contents);
    }
    await publish();
    for (const extension of Object.keys(files)) {
      const filename = name + extension;
      const target = join(directory, filename);
      await rename(join(temporary, filename), target);
      saved.push(target);
    }
  } catch (error) {
    await Promise.all(saved.map(path => rm(path, { force: true })));
    throw error;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
  return {
    pdfPath: join(directory, name + '.pdf'), receiptPath: join(directory, name + '.json'),
    manifestPath: join(directory, name + '.manifest.json'),
  };
}

export function createExports(
  store: Store, engine: typeof Engine, exports: typeof Export, ports: ExportPorts, cloud: Cloud,
  context: (caseId: string) => Context, listCases: () => CaseRecord[],
) {
  const signer = createSigner(store, exports);

  function prepareDraft(kind: Parameters<CourtPlusApi['exportDraft']>[0], caseId: string, lang: string) {
    const { person, record, cases } = context(caseId);
    const asOf = record.orderDate ?? indiaDate();
    const result = engine.screen(person, cases, caseId, asOf);
    const settings = readSettings(store);
    const profile = readProfile(store);
    const prison = settings.prison || profile?.office || '';
    const district = settings.district || profile?.district || '';
    if (kind === 'S479_3_APPLICATION' && result.status !== 'APPLY_NOW') {
      throw new Error('The engine result as of ' + asOf + ' is ' + result.status
        + ', not APPLY_NOW. Send this case for lawyer review instead of drafting a s.479(3) application.');
    }
    if (kind === 'DLSA_7_DAY' && !record.bailGrantedOn) throw new Error('Record the confirmed bail grant date first.');
    const sources = [...record.charges, ...record.custody, ...record.events].flatMap(item => item.source ? [item.source] : []);
    const confirmedBy = sources.find(source => source.verifiedBy?.trim())?.verifiedBy?.trim();
    if (kind === 'AI_ASSISTANCE_NOTE' && !confirmedBy) {
      throw new Error('This case has no recorded confirmer. Import the order again and enter who confirmed the facts.');
    }
    const options = { localizationRoot: ports.localizationRoot };
    const drafts: Record<typeof kind, () => string> = {
      S479_3_APPLICATION: () => exports.renderHtml('S479_3_APPLICATION', {
        person, caseRecord: record, prison, result,
      }, lang, options),
      DLSA_7_DAY: () => exports.renderHtml('DLSA_7_DAY', {
        person, caseRecord: { court: record.court, caseNo: record.caseNo, bailGrantedOn: record.bailGrantedOn! },
        prison, district, custodyCheckedOn: asOf,
      }, lang, options),
      AI_ASSISTANCE_NOTE: () => exports.renderHtml('AI_ASSISTANCE_NOTE', {
        model: 'CourtPlus order reader',
        orderReference: sources[0]?.docId ?? '',
        suggestedFields: [...new Set(sources.flatMap(source => store.document(source.docId)?.suggestedFields ?? []))],
        confirmedBy: confirmedBy ?? '',
      }, lang, options),
      RIGHTS_CARD: () => exports.renderHtml('RIGHTS_CARD', { dlsaName: district }, lang, options),
    };
    return { html: drafts[kind](), person, record, result, settings };
  }

  const previewDraft = async (...args: Parameters<CourtPlusApi['exportDraft']>) => prepareDraft(...args).html;
  const exportDraft: CourtPlusApi['exportDraft'] = async (kind, caseId, lang) => {
    const { html, person, record, result, settings: { issuer, backendUrl } } = prepareDraft(kind, caseId, lang);
    const directory = await ports.folder();
    if (!directory) throw new Error('Export cancelled.');
    const online = Boolean(backendUrl && cloud.status().role);
    const key = signer.key(issuer);
    const { receipt, receiptId, receiptDigest } = exports.createReceipt({
      issuer, result, inputs: { person, record, kind, lang, htmlDigest: createHash('sha256').update(html).digest('hex') },
    }, key);
    const verifyUrl = online && backendUrl + '/v/' + receiptId;
    const qr = verifyUrl
      ? await QRCode.toDataURL(verifyUrl, { errorCorrectionLevel: 'M', margin: 2 })
      : await exports.encodeReceiptQr(receiptId, key.keyId, receiptDigest);
    const printed = await ports.print(html.replace('</main>',
      '<div class="receipt"><img alt="Receipt QR code" src="' + qr + '">Receipt verification QR code</div></main>'));
    const manifest = exports.createManifest(printed, receipt, key);
    const paths = await saveBundle(directory, receiptId, {
      '.pdf': printed, '.json': receipt, '.manifest.json': manifest,
    }, async () => {
      if (online) await cloud.publish(backendUrl, { receipt, manifest });
    });
    store.audit('draft.export', { caseId, kind, lang, receiptId });
    return paths;
  };

  const exportScReturn: CourtPlusApi['exportScReturn'] = async (asOf, format) => {
    const path = await ports.savePath('courtplus-sc-return-' + asOf + '.' + format);
    if (!path) throw new Error('Export cancelled.');
    const { prison } = readSettings(store);
    const rows: Export.ScReturnRow[] = listCases().map(record => {
      const { person, cases } = context(record.id);
      const result = engine.screen(person, cases, record.id, asOf);
      const dates = record.custody.filter(spell => spell.kind === 'judicial' && spell.start <= asOf)
        .map(spell => spell.start).sort();
      return {
        prison, prisonerAlias: person.alias,
        crimeNumberAndSections: [record.caseNo, record.policeStation,
          ...record.charges.map(charge => [charge.act, charge.section].join(' '))].filter(Boolean).join(' · '),
        admissionOn: dates[0],
        maximumSentence: result.maxTermDays === undefined ? undefined : result.maxTermDays + ' days',
        totalCustodyDays: result.rawCustodyDays,
        releasedOn: record.releasedOn && record.releasedOn <= asOf ? record.releasedOn : undefined,
      };
    });
    await writeFile(path, format === 'csv' ? exports.renderScReturnCsv(rows) : await exports.renderScReturnXlsx(rows));
    store.audit('sc-return.export', { asOf, format, rows: rows.length });
    return path;
  };

  const verify: CourtPlusApi['verify'] = async ({ pdf, receipt, manifest }) => {
    const local = exports.verify({ pdf, receipt, manifest, trustStore: signer.trustStore() });
    if (local.signature !== 'unknown_signer') return local;
    return await cloud.verifyDigest({ receipt, manifest, pdfDigest: createHash('sha256').update(pdf).digest('hex') }) ?? local;
  };

  return { exportDraft, previewDraft, exportScReturn, verify, signer };
}
