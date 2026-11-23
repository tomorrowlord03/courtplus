import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CaseRecord, CourtPlusApi, ISODate, Person, ScreeningResult } from '@courtplus/contracts';
import { documentFont, readOptional, resourceRoot, type Language, type RenderOptions } from './resources.js';
import { rightsCopy } from './rights.js';

const statuteQuotes: Record<'bnss479_1' | 'bnss479_2' | 'bnss479_3', { text: string }> =
  JSON.parse(readFileSync(join(resourceRoot, 'data', 'statutes', 'quotes.json'), 'utf8'));
const section479 = [statuteQuotes.bnss479_1, statuteQuotes.bnss479_2, statuteQuotes.bnss479_3]
  .map(({ text }) => text).join('\n\n');

interface Signatures {
  verifiedBy?: string;
  attestedBy?: string;
}

export interface ApplicationData extends Signatures {
  person: Pick<Person, 'alias'>;
  caseRecord: Pick<CaseRecord, 'court' | 'caseNo' | 'charges'>;
  prison: string;
  result: ScreeningResult;
}

export interface DlsaIntimationData extends Signatures {
  person: Pick<Person, 'alias'>;
  caseRecord: Pick<CaseRecord, 'court' | 'caseNo'> & { bailGrantedOn: ISODate };
  prison: string;
  district: string;
  custodyCheckedOn: ISODate;
  releaseBarrier?: string;
}

export interface AiAssistanceData {
  model: string;
  orderReference: string;
  suggestedFields: readonly string[];
  confirmedBy: string;
}

export interface RightsCardData {
  dlsaName?: string;
  dlsaPhone?: string;
}

export interface DlsaHandoffData {
  date: ISODate;
  prison: string;
  dlsaName: string;
  auditLogHead: string;
  handedOverBy?: string;
  receivedBy?: string;
}

export interface DraftData {
  S479_3_APPLICATION: ApplicationData;
  DLSA_7_DAY: DlsaIntimationData;
  AI_ASSISTANCE_NOTE: AiAssistanceData;
  RIGHTS_CARD: RightsCardData;
  DLSA_HANDOFF: DlsaHandoffData;
}

export type DraftKind = Parameters<CourtPlusApi['exportDraft']>[0] | 'DLSA_HANDOFF';
type LegalLanguage = 'en' | 'hi';
type TextValue = string | number | undefined;

const escapeCharacters: Record<string, string> = {
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
};

function escapeHtml(value: TextValue) {
  return String(value ?? '—').replace(/[&<>"']/g, (character) => escapeCharacters[character]);
}

function template(file: string, values: Record<string, TextValue>, fragments: Record<string, string> = {}) {
  const html = readFileSync(join(resourceRoot, 'templates', file), 'utf8');
  return html.replace(/\{\{(\w+)\}\}/g, (_, name: string) => {
    if (Object.hasOwn(fragments, name)) return fragments[name];
    if (Object.hasOwn(values, name)) return escapeHtml(values[name]);
    throw new Error('Missing template value for ' + name + ' in ' + file);
  });
}

function factsTable(facts: readonly (readonly [string, TextValue])[]) {
  return facts.map(([label, value]) =>
    '<tr><th scope="row">' + escapeHtml(label) + '</th><td><bdi>' + escapeHtml(value) + '</bdi></td></tr>',
  ).join('\n');
}

function listItems(values: readonly string[]) {
  return values.map((value) => '<li dir="auto">' + escapeHtml(value) + '</li>').join('\n');
}

function orderedList(values: readonly string[]) {
  return '<ol>' + listItems(values) + '</ol>';
}

interface DocumentBody {
  title: string;
  body: string;
  lang: Language;
  notice?: string;
  draft?: boolean;
}

function application(data: ApplicationData, lang: LegalLanguage): DocumentBody {
  const { person, caseRecord, prison, result } = data;
  const charges = caseRecord.charges.map(({ act, section, subsection, variant }) =>
    [act, section + (subsection ?? ''), variant].filter(Boolean).join(' '),
  ).join(', ');
  const labels = lang === 'hi'
    ? ['बंदी का उपनाम', 'प्रकरण संख्या', 'जेल', 'अधिनियम और धाराएँ', 'अधिकतम कारावास (दिन)',
        'कुल अभिरक्षा (दिन)', 'गणना में शामिल अभिरक्षा (दिन)', 'लागू अनुपात', 'सीमा की तारीख', 'नियम का संस्करण']
    : ['Undertrial alias', 'Case reference', 'Prison', 'Acts and sections', 'Maximum term (days)',
        'Total custody (days)', 'Counted custody (days)', 'Applicable fraction', 'Threshold date', 'Rule version'];
  const values = [
    person.alias, caseRecord.caseNo, prison, charges || undefined, result.maxTermDays,
    result.rawCustodyDays, result.countedCustodyDays, result.thresholdFraction, result.thresholdDate,
    result.ruleVersion,
  ];
  const traceSteps = result.trace.map(({ label, operation, result: outcome, warnings }) =>
    [label + ' — ' + operation + ' — ' + outcome, ...(warnings ?? [])].join(' '),
  );
  const trace = orderedList([result.status, result.dayConvention, ...result.reasons, ...traceSteps]);
  return {
    title: lang === 'hi' ? 'धारा 479(3) के अंतर्गत जेल अधीक्षक का आवेदन' : 'Jail Superintendent’s application under section 479(3)',
    lang,
    draft: true,
    body: template('s479-3-application.' + lang + '.html', {
      court: caseRecord.court,
      alias: person.alias,
      asOf: result.asOf,
      statute: section479,
      verifiedBy: data.verifiedBy,
      attestedBy: data.attestedBy,
    }, { facts: factsTable(labels.map((label, i) => [label, values[i]])), trace }),
  };
}

function dlsaIntimation(data: DlsaIntimationData, lang: LegalLanguage): DocumentBody {
  const { caseRecord } = data;
  const labels = lang === 'hi'
    ? ['बंदी का उपनाम', 'प्रकरण संख्या', 'न्यायालय', 'जेल', 'जमानत मंजूर होने की तारीख', 'अभिरक्षा सत्यापन की तारीख', 'रिहाई में बाधा']
    : ['Prisoner alias', 'Case reference', 'Court', 'Prison', 'Bail granted on', 'Custody verified on', 'Barrier to release'];
  const values = [
    data.person.alias, caseRecord.caseNo, caseRecord.court, data.prison, caseRecord.bailGrantedOn,
    data.custodyCheckedOn, data.releaseBarrier,
  ];
  return {
    title: lang === 'hi' ? 'जमानत के सात दिन बाद रिहाई न होने की सूचना' : 'Seven-day non-release intimation to the DLSA',
    lang,
    draft: true,
    body: template('dlsa-7-day.' + lang + '.html', {
      district: data.district,
      verifiedBy: data.verifiedBy,
      attestedBy: data.attestedBy,
    }, { facts: factsTable(labels.map((label, i) => [label, values[i]])) }),
  };
}

function aiAssistance(data: AiAssistanceData, lang: LegalLanguage): DocumentBody {
  const fields = data.suggestedFields.map((field) => field.trim()).filter(Boolean);
  if (!data.model.trim() || !data.confirmedBy.trim() || fields.length === 0) {
    throw new Error('The AI assistance note needs a model, a named confirmer and at least one suggested field');
  }
  return {
    title: lang === 'hi' ? 'कृत्रिम बुद्धिमत्ता से प्राप्त सहायता का विवरण' : 'AI assistance note',
    lang,
    draft: true,
    body: template('ai-assistance-note.' + lang + '.html', {
      model: data.model, confirmedBy: data.confirmedBy, orderReference: data.orderReference,
    }, { suggestedFields: orderedList(fields) }),
  };
}

function handoff(data: DlsaHandoffData, lang: LegalLanguage): DocumentBody {
  if (!/^[a-f0-9]{64}$/.test(data.auditLogHead)) throw new Error('Expected a SHA-256 audit chain-head hash');
  return {
    title: lang === 'hi' ? 'जिला विधिक सेवा प्राधिकरण को हस्तांतरण पत्रक' : 'DLSA handoff sheet',
    lang,
    body: template('dlsa-handoff.' + lang + '.html', {
      date: data.date, prison: data.prison, dlsaName: data.dlsaName, auditLogHead: data.auditLogHead,
      handedOverBy: data.handedOverBy, receivedBy: data.receivedBy,
    }),
  };
}

function load1MonthPostBail(root: string, lang: Language): string | undefined {
  const file = readOptional(join(root, 'data', 'i18n', lang + '.json'));
  if (!file) return undefined;
  try {
    const parsed = JSON.parse(file.toString('utf8').replace(/^\uFEFF/, ''));
    if (typeof parsed?.rights_post_bail_1_month === 'string' && parsed.rights_post_bail_1_month.trim()) {
      return parsed.rights_post_bail_1_month;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function rightsCard(data: RightsCardData, _lang: LegalLanguage, root: string, requested: string): DocumentBody {
  const { copy, lang, notice } = rightsCopy(root, requested);
  const contacts = { dlsaName: data.dlsaName ?? '—', dlsaPhone: data.dlsaPhone ?? '—' };
  const contact = copy.rights_contact.replace(/\{(dlsaName|dlsaPhone)\}/g,
    (_match, key: keyof typeof contacts) => contacts[key],
  );
  const postBail1Month = load1MonthPostBail(root, lang) ?? (lang !== 'en' ? load1MonthPostBail(root, 'en') : undefined);
  const rightsItems = [
    copy.rights_legal_aid_statutory,
    copy.rights_bnss_479_release,
    copy.rights_superintendent_duty,
    copy.rights_post_bail_7_days,
    ...(postBail1Month ? [postBail1Month] : []),
    copy.rights_ask_lawyer,
  ];
  return {
    title: copy.rights_card_title,
    lang,
    notice,
    body: template('rights-card.html', { contact, disclaimer: copy.rights_disclaimer }, {
      rights: listItems(rightsItems),
    }),
  };
}

type Renderers = {
  [K in DraftKind]: (data: DraftData[K], lang: LegalLanguage, root: string, requested: string) => DocumentBody;
};

const renderers: Renderers = {
  S479_3_APPLICATION: application,
  DLSA_7_DAY: dlsaIntimation,
  AI_ASSISTANCE_NOTE: aiAssistance,
  RIGHTS_CARD: rightsCard,
  DLSA_HANDOFF: handoff,
};

export function renderDocument<K extends DraftKind>(
  kind: K,
  data: DraftData[NoInfer<K>],
  requested: string,
  options: RenderOptions,
  receiptQr?: string,
): string {
  const root = options.localizationRoot ?? resourceRoot;
  const legalLang = /^hi(?:-|$)/i.test(requested.trim()) ? 'hi' : 'en';
  const { title, body, lang, notice, draft } = renderers[kind](data, legalLang, root, requested);
  const font = documentFont(lang, root);
  const warning = lang === 'hi' && kind !== 'RIGHTS_CARD'
    ? 'इस हिंदी कानूनी पाठ की किसी दक्ष विधिक पाठक से समीक्षा आवश्यक है। Needs review by a fluent legal reader.'
    : notice;
  const qrLabel = lang === 'hi' ? 'रसीद खोजने के लिए QR कोड' : 'Receipt lookup QR code';
  const watermark = lang === 'hi'
    ? '<div class="watermark" style="font-family: inherit">DRAFT / प्रारूप</div>'
    : '<div class="watermark">DRAFT</div>';
  return template('layout.html', { lang, direction: lang === 'ur' ? 'rtl' : 'ltr', title }, {
    fontFamily: font.family,
    fonts: font.css,
    notice: warning ? '<p class="notice" dir="auto">' + escapeHtml(warning) + '</p>' : '',
    watermark: draft ? watermark : '',
    body,
    qr: receiptQr ? '<div class="receipt"><img alt="" src="' + escapeHtml(receiptQr) + '">' + qrLabel + '</div>' : '',
  });
}

export function renderHtml<K extends DraftKind>(
  kind: K,
  data: DraftData[NoInfer<K>],
  lang: string,
  options: RenderOptions = {},
): string {
  return renderDocument(kind, data, lang, options);
}
