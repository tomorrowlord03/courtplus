import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { IpcMainInvokeEvent } from 'electron';
import type { CaseAnalysis, Entity, LawyerToolsApi, ScreeningResult, SettlementProposal } from '@courtplus/contracts' with { 'resolution-mode': 'import' };
import type * as Engine from '@courtplus/engine' with { 'resolution-mode': 'import' };
import type * as Export from '@courtplus/export' with { 'resolution-mode': 'import' };
import type { Store } from '../store';
import { indiaDate } from './board';
import { createResearchAdapter, sourceSentences } from './research-adapter';
import { readSettings } from './settings';
import type { createSigner } from './signer';

const hint = 'Hint - the judge decides';
const unavailable = 'Precedent search loading - available after model install';
const headingRoles = ['Facts', 'Issues', 'Arguments', 'Reasoning'] as const;
const roleLabels: Record<string, typeof headingRoles[number]> = {
  fact: 'Facts', facts: 'Facts', issue: 'Issues', issues: 'Issues',
  argumentpetitioner: 'Arguments', argumentrespondent: 'Arguments',
  analysis: 'Reasoning', reasoning: 'Reasoning', ratioofthedecision: 'Reasoning',
  precedentreliedupon: 'Reasoning', precedentnotreliedupon: 'Reasoning', precedentoverruled: 'Reasoning',
  rulingbylowercourt: 'Reasoning', rulingbypresentcourt: 'Reasoning', dissent: 'Reasoning',
};
const entityLabels = new Set<Entity['label']>([
  'PETITIONER', 'RESPONDENT', 'WITNESS', 'OTHER_PERSON', 'LAWYER', 'GPE', 'STATUTE', 'PROVISION',
]);
const maxFileSize = 32 * 1024 * 1024;
const maxResearchChars = 60_000;

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[c]!);
const fill = (template: string, values: Record<string, string>) => template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
  if (!Object.hasOwn(values, key)) throw new Error('Missing document template field ' + key);
  return values[key];
});
const list = (items: string[]) => items.length ? '<ul>' + items.map(item => '<li dir="auto">' + escapeHtml(item) + '</li>').join('') + '</ul>'
  : '<p>No entries found.</p>';

interface Ports {
  resourceDirectory: string;
  folder: () => Promise<string | undefined>;
  print: (html: string) => Promise<Uint8Array>;
}

function researchHtml<T>(data: { available: true; value: T } | { available: false }, render: (value: T) => string) {
  return data.available ? render(data.value) : '<p>' + unavailable + '</p>';
}

function reportBody(analysis: CaseAnalysis, confirmedBy: string): string {
  const section = (heading: string, body: string) => '<h2>' + escapeHtml(heading) + '</h2>' + body;
  const summary = researchHtml(analysis.summary, rows => list(rows.map(row => row.text + '\nSource: ' + row.source)));
  const roles = researchHtml(analysis.roles, groups => headingRoles.map(role => '<h3>' + role + '</h3>'
    + list(groups[role].map(row => row.text + '\nSource: ' + row.source))).join(''));
  const sections = researchHtml(analysis.sections, rows => list(rows.map(row => [
    row.act + ' §' + row.section + ' ' + row.title, row.source,
    ...row.bns.map(item => 'BNS §' + item.section + ' — ' + item.note + ' — ' + item.source + ', page ' + item.page),
  ].join('\n'))));
  const precedents = researchHtml(analysis.precedents, rows => list(rows.map(row =>
    [row.title, row.citation, row.year ?? 'Year unavailable', row.court, row.url, row.paragraph].filter(Boolean).join('\n'))));
  return '<p>' + hint + '</p><p>Reviewed by ' + escapeHtml(confirmedBy) + '</p>'
    + '<p>Pages read: ' + analysis.pages + (analysis.ocr ? ' (includes OCR)' : '') + '.</p>'
    + (analysis.researchLimited ? '<p>Research used the first 60,000 characters of the masked document.</p>' : '')
    + section('Summary', summary) + section('Facts, issues, arguments and reasoning', roles)
    + section('People, places and sections', (!analysis.nerAvailable ? '<p>Local name and place recognition unavailable. Review masking manually.</p>' : '')
      + list(analysis.entities.map(row => [row.label, row.text, row.page ? 'Page ' + row.page : ''].filter(Boolean).join(' · '))))
    + section('Suggested sections', sections) + section('Similar past cases', precedents)
    + section('Weak points and procedural gaps', list(analysis.checklist.map(item =>
      [item.label, item.check, 'Case excerpt: ' + item.evidence, ...item.sources.map(source =>
        source.act + ' ' + source.section + ' — ' + source.url)].join('\n'))));
}

async function documentHtml(resourceDirectory: string, title: string, body: string, draft: boolean, qr = '') {
  const template = await readFile(join(resourceDirectory, 'templates', 'layout.html'), 'utf8');
  return fill(template, {
    lang: 'en', direction: 'ltr', title: escapeHtml(title), body, fonts: '',
    fontFamily: "'Noto Sans', 'Nirmala UI', 'Mangal'", notice: '',
    watermark: draft ? '<div class="watermark">DRAFT</div>' : '',
    qr: qr ? '<div class="receipt"><img alt="Receipt QR code" src="' + escapeHtml(qr) + '">Receipt verification QR code</div>' : '',
  });
}

async function proposalBody(resourceDirectory: string, proposal: SettlementProposal) {
  const template = await readFile(join(resourceDirectory, 'templates', 'settlement-proposal.en.html'), 'utf8');
  return fill(template, Object.fromEntries(Object.entries(proposal).map(([key, value]) => [key, escapeHtml(value || '—')])));
}

function saveSignedPdf(store: Store, ports: Ports, exports: typeof Export, signer: ReturnType<typeof createSigner>) {
  return async (title: string, body: string, kind: 'analysis' | 'settlement', sourceId?: string) => {
    const directory = await ports.folder();
    if (!directory) throw new Error('Export cancelled.');
    const { issuer } = readSettings(store);
    const key = signer.key(issuer);
    // The verifier's shared receipt format requires screening fields. This document has no screening result.
    const result: ScreeningResult = {
      personId: '', caseId: sourceId ?? '', asOf: indiaDate(), ruleVersion: 'lawyer-tools-v1',
      dayConvention: 'Asia/Kolkata civil date', status: 'OUTSIDE_SCREEN',
      rawCustodyDays: 0, countedCustodyDays: 0, ceilingUrgent: false,
      reasons: [], alerts: [], nalsaCategories: [], trace: [],
    };
    const { receipt, receiptId, receiptDigest } = exports.createReceipt({
      issuer, result, inputs: { kind, sourceId: sourceId ?? null, bodyDigest: createHash('sha256').update(body).digest('hex') },
    }, key);
    const qr = await exports.encodeReceiptQr(receiptId, key.keyId, receiptDigest);
    const html = await documentHtml(ports.resourceDirectory, title, body, kind === 'settlement', qr);
    const pdf = await ports.print(html);
    const manifest = exports.createManifest(pdf, receipt, key);
    const paths = {
      pdfPath: join(directory, receiptId + '.pdf'),
      receiptPath: join(directory, receiptId + '.json'),
      manifestPath: join(directory, receiptId + '.manifest.json'),
    };
    const temporary = await mkdtemp(join(directory, '.courtplus-lawyer-'));
    const saved: string[] = [];
    try {
      const files = [[paths.pdfPath, pdf], [paths.receiptPath, receipt], [paths.manifestPath, manifest]] as const;
      for (const [index, [, contents]] of files.entries()) await writeFile(join(temporary, String(index)), contents);
      for (const [index, [destination]] of files.entries()) {
        await rename(join(temporary, String(index)), destination);
        saved.push(destination);
      }
      store.audit('lawyer.' + kind + '.export', { receiptId });
      return paths;
    } catch (error) {
      await Promise.all(saved.map(path => rm(path, { force: true })));
      throw error;
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  };
}

export function createLawyerHandlers(store: Store, engine: typeof Engine, exports: typeof Export,
  signer: ReturnType<typeof createSigner>, ports: Ports) {
  const research = createResearchAdapter(ports.resourceDirectory);
  const save = saveSignedPdf(store, ports, exports, signer);
  let lastAnalysis: { analysis: CaseAnalysis; docId: string } | undefined;
  let analyzing = false;

  const api: LawyerToolsApi = {
    pastAwards: research.awards,
    async analyzeCase(file) {
      if (analyzing) throw new Error('A case file is already being analyzed.');
      analyzing = true;
      lastAnalysis = undefined;
      try {
        const intake = await import('@courtplus/intake');
        const order = await intake.importOrder(file, join(ports.resourceDirectory, 'model'));
        if (!order.redactedText.trim()) throw new Error('No text could be read from this case file.');
        const researchText = order.redactedText.slice(0, maxResearchChars);
        const sentences = sourceSentences(researchText);
        const [summary, roles, sections, precedents] = await Promise.all([
          research.summary(researchText), research.roles(sentences.map(item => item.text)),
          research.sections(researchText), research.precedents(researchText),
        ]);
        const groups: Record<typeof headingRoles[number], typeof sentences> = { Facts: [], Issues: [], Arguments: [], Reasoning: [] };
        if (roles.available) for (const { role, index } of roles.value) {
          const group = roleLabels[role.toLowerCase().replace(/[^a-z]/g, '')];
          if (group && sentences[index]) groups[group].push(sentences[index]);
        }
        const entities = order.entities.filter(entity => entityLabels.has(entity.label) && entity.text.trim())
          .map(({ label, text, page }) => ({ label, text, page }));
        const seen = new Set(entities.map(entity => entity.text.toLowerCase()));
        for (const suggestion of order.suggestions) {
          if ((suggestion.field === 'section' || suggestion.field === 'citedProvision') && !seen.has(suggestion.value.toLowerCase())) {
            entities.push({ label: 'PROVISION', text: suggestion.value, page: suggestion.page });
            seen.add(suggestion.value.toLowerCase());
          }
        }
        const analysis: CaseAnalysis = {
          id: randomUUID(), pages: order.pages, ocr: order.ocr, nerAvailable: !order.aiUnavailable,
          researchLimited: order.redactedText.length > maxResearchChars,
          maskedText: order.redactedText, entities,
          checklist: engine.proceduralChecklist(order.redactedText), summary,
          roles: roles.available ? { available: true, value: groups } : roles,
          sections, precedents,
        };
        lastAnalysis = { analysis, docId: order.docId };
        return analysis;
      } finally {
        analyzing = false;
      }
    },
    exportAnalysis(id, confirmedBy) {
      if (lastAnalysis?.analysis.id !== id) throw new Error('Analyze and review the current file before exporting.');
      return save('Case analysis', reportBody(lastAnalysis.analysis, confirmedBy), 'analysis', lastAnalysis.docId);
    },
    async previewSettlement(proposal) {
      return documentHtml(ports.resourceDirectory, 'Settlement proposal', await proposalBody(ports.resourceDirectory, proposal), true);
    },
    async exportSettlement(proposal) {
      if (!proposal.parties || !proposal.terms) throw new Error('Enter parties and proposed terms before exporting.');
      return save('Settlement proposal', await proposalBody(ports.resourceDirectory, proposal), 'settlement');
    },
  };
  return api;
}

export function registerLawyerHandlers(api: LawyerToolsApi) {
  if (!process.versions.electron || process.type !== 'browser') return;
  const { ipcMain, BrowserWindow, session } = require('electron') as typeof import('electron');
  const { appUrl, developmentUrl, isSameOrigin } = require('../renderer') as typeof import('../renderer');
  const url = process.argv.includes('--courtplus-diagnostics') ? appUrl : developmentUrl()?.href ?? appUrl;

  function register<Args extends unknown[]>(name: string, schema: z.ZodType<Args>, invoke: (...args: NoInfer<Args>) => unknown) {
    ipcMain.handle('desktop:lawyer:' + name, (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      const frame = event.senderFrame;
      if (!frame || frame !== event.sender.mainFrame || !isSameOrigin(frame.url, url)
        || event.sender.session !== session.fromPartition('courtplus') || !BrowserWindow.fromWebContents(event.sender)) {
        throw new Error('FORBIDDEN');
      }
      return invoke(...schema.parse(args));
    });
  }

  const proposal = z.strictObject({
    route: z.enum(['Lok Adalat', 'Mediation']),
    caseReference: z.string().trim().max(250), parties: z.string().trim().max(2_000),
    terms: z.string().trim().max(12_000), deadlines: z.string().trim().max(3_000),
  });
  register('pastAwards', z.tuple([z.string().trim().min(3).max(10_000)]), api.pastAwards);
  register('analyzeCase', z.tuple([z.strictObject({
    name: z.string().min(1).max(255),
    bytes: z.instanceof(Uint8Array).refine(bytes => bytes.byteLength > 0 && bytes.byteLength <= maxFileSize, 'Use a case file up to 32 MB.'),
  })]), api.analyzeCase);
  register('exportAnalysis', z.tuple([z.uuid(), z.string().trim().min(1).max(150)]), api.exportAnalysis);
  register('previewSettlement', z.tuple([proposal]), api.previewSettlement);
  register('exportSettlement', z.tuple([proposal]), api.exportSettlement);
}
