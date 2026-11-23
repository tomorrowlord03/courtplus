import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CaseRecord, CourtPlusApi, ISODate, Person, ScreeningResult } from '@courtplus/contracts';
import { documentFont, readOptional, resourceRoot, type Language, type RenderOptions } from './resources.js';
import { rightsCopy } from './rights.js';

const statuteQuotes: Record<'bnss479_1' | 'bnss479_2' | 'bnss479_3', { text: string }> =
  JSON.parse(readFileSync(join(resourceRoot, 'data', 'statutes', 'quotes.json'), 'utf8'));
const section479 = [statuteQuotes.bnss479_1, statuteQuotes.bnss479_2, statuteQuotes.bnss479_3]
  .map(({ text }) => text).join('\n\n');
const draftListLines = ['________________________________', '________________________________'];

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

export interface InterimOrderSheetData {
  court?: string;
  caseNo?: string;
  parties?: string;
  date?: ISODate;
  presidingOfficer?: string;
  appearances?: string;
  proceedings?: string;
  directions?: string;
  nextDate?: ISODate;
  nextPurpose?: string;
  benchNotes?: string;
}

export interface NoticeToAppearData {
  court?: string;
  caseNo?: string;
  parties?: string;
  recipientName?: string;
  recipientRole?: string;
  recipientAddress?: string;
  date?: ISODate;
  appearanceDate?: ISODate;
  appearanceTime?: string;
  purpose?: string;
  documentsRequired?: string;
  consequenceOfDefault?: string;
  issuedBy?: string;
}

export interface AdjournmentOrderData {
  court?: string;
  caseNo?: string;
  parties?: string;
  date?: ISODate;
  requestingParty?: string;
  reason?: string;
  adjournmentCount?: number;
  statutoryLimitNote?: string;
  costs?: string;
  nextDate?: ISODate;
  nextPurpose?: string;
  judgeName?: string;
}

export interface JudgmentOutlineData {
  court?: string;
  caseNo?: string;
  parties?: string;
  date?: ISODate;
  judgeName?: string;
  facts?: string;
  issues?: readonly string[];
  evidenceNotes?: string;
  argumentsNotes?: string;
  reasoningNotes?: string;
  findingsPrompt?: string;
  orderPrompt?: string;
}

export interface RegularBailApplicationData {
  court?: string;
  caseNo?: string;
  applicant?: string;
  respondent?: string;
  policeStation?: string;
  charges?: string;
  arrestDate?: ISODate;
  custodyPeriod?: string;
  facts?: string;
  grounds?: readonly string[];
  undertakings?: readonly string[];
  prayer?: string;
  advocateName?: string;
  advocateEnrollment?: string;
  verifiedBy?: string;
}

export interface AnticipatoryBailApplicationData {
  court?: string;
  applicant?: string;
  respondent?: string;
  policeStation?: string;
  allegedOffences?: string;
  apprehensionReason?: string;
  facts?: string;
  grounds?: readonly string[];
  undertakings?: readonly string[];
  prayer?: string;
  advocateName?: string;
  advocateEnrollment?: string;
  verifiedBy?: string;
}

export interface LegalNoticeData {
  date?: ISODate;
  sender?: string;
  senderAddress?: string;
  recipient?: string;
  recipientAddress?: string;
  advocateName?: string;
  advocateAddress?: string;
  advocateContact?: string;
  transactionFacts?: string;
  defaultDetails?: string;
  claimAmount?: string;
  curePeriodDays?: number;
  consequences?: string;
}

export interface ChequeBounceNoticeData {
  date?: ISODate;
  drawer?: string;
  drawerAddress?: string;
  payee?: string;
  payeeAddress?: string;
  advocateName?: string;
  advocateAddress?: string;
  chequeNo?: string;
  chequeDate?: ISODate;
  chequeAmount?: string;
  draweeBank?: string;
  presentationDate?: ISODate;
  returnDate?: ISODate;
  returnReason?: string;
  memoReceiptDate?: ISODate;
}

export interface DraftData {
  S479_3_APPLICATION: ApplicationData;
  DLSA_7_DAY: DlsaIntimationData;
  AI_ASSISTANCE_NOTE: AiAssistanceData;
  RIGHTS_CARD: RightsCardData;
  DLSA_HANDOFF: DlsaHandoffData;
  INTERIM_ORDER_SHEET: InterimOrderSheetData;
  NOTICE_TO_APPEAR: NoticeToAppearData;
  ADJOURNMENT_ORDER: AdjournmentOrderData;
  JUDGMENT_OUTLINE: JudgmentOutlineData;
  REGULAR_BAIL_APPLICATION: RegularBailApplicationData;
  ANTICIPATORY_BAIL_APPLICATION: AnticipatoryBailApplicationData;
  LEGAL_NOTICE: LegalNoticeData;
  CHEQUE_BOUNCE_NOTICE: ChequeBounceNoticeData;
}

export type DraftKind = keyof DraftData;
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

function unorderedList(values: readonly string[]) {
  return '<ul>' + listItems(values) + '</ul>';
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

function interimOrderSheet(data: InterimOrderSheetData, lang: LegalLanguage): DocumentBody {
  return {
    title: lang === 'hi' ? 'अंतरिम आदेश पत्रक (Interim Order Sheet)' : 'Interim Order Sheet',
    lang,
    draft: true,
    body: template('interim-order-sheet.' + lang + '.html', {
      court: data.court,
      caseNo: data.caseNo,
      parties: data.parties,
      date: data.date,
      presidingOfficer: data.presidingOfficer,
      appearances: data.appearances,
      proceedings: data.proceedings,
      directions: data.directions,
      nextDate: data.nextDate,
      nextPurpose: data.nextPurpose,
      benchNotes: data.benchNotes,
    }),
  };
}

function noticeToAppear(data: NoticeToAppearData, lang: LegalLanguage): DocumentBody {
  return {
    title: lang === 'hi' ? 'उपसंजात होने हेतु सूचना (Notice to Appear)' : 'Notice to Appear',
    lang,
    draft: true,
    body: template('notice-to-appear.' + lang + '.html', {
      court: data.court,
      caseNo: data.caseNo,
      parties: data.parties,
      recipientName: data.recipientName,
      recipientRole: data.recipientRole,
      recipientAddress: data.recipientAddress,
      date: data.date,
      appearanceDate: data.appearanceDate,
      appearanceTime: data.appearanceTime,
      purpose: data.purpose,
      documentsRequired: data.documentsRequired,
      consequenceOfDefault: data.consequenceOfDefault,
      issuedBy: data.issuedBy,
    }),
  };
}

function adjournmentOrder(data: AdjournmentOrderData, lang: LegalLanguage): DocumentBody {
  return {
    title: lang === 'hi' ? 'स्थगन आदेश (Adjournment Order)' : 'Adjournment Order',
    lang,
    draft: true,
    body: template('adjournment-order.' + lang + '.html', {
      court: data.court,
      caseNo: data.caseNo,
      parties: data.parties,
      date: data.date,
      requestingParty: data.requestingParty,
      reason: data.reason,
      adjournmentCount: data.adjournmentCount,
      statutoryLimitNote: data.statutoryLimitNote,
      costs: data.costs,
      nextDate: data.nextDate,
      nextPurpose: data.nextPurpose,
      judgeName: data.judgeName,
    }),
  };
}

function judgmentOutline(data: JudgmentOutlineData, lang: LegalLanguage): DocumentBody {
  const verifiedBadge = lang === 'hi'
    ? 'Draft from case record - verify / प्रकरण अभिलेख से प्रारूप - सत्यापन करें'
    : 'Draft from case record - verify';
  const factsBlock = data.facts
    ? '<div class="notice" style="margin-bottom:6pt"><span class="badge">' + verifiedBadge + '</span></div><p dir="auto">' + escapeHtml(data.facts) + '</p>'
    : '<p><em>' + (lang === 'hi' ? '[पीठासीन न्यायाधीश द्वारा अभिलिखित किए जाने हैं]' : '[To be recorded by the Presiding Judge]') + '</em></p>';
  const issuesBlock = data.issues && data.issues.length > 0
    ? '<div class="notice" style="margin-bottom:6pt"><span class="badge">' + verifiedBadge + '</span></div>' + orderedList(data.issues)
    : '<p><em>' + (lang === 'hi' ? '[न्यायालय द्वारा विचारणीय बिंदु विरचित किए जाने हैं]' : '[Points for determination to be framed by the Court]') + '</em></p>';

  return {
    title: lang === 'hi' ? 'निर्णय प्रारूप (Judgment Outline)' : 'Judgment Outline',
    lang,
    draft: true,
    body: template('judgment-outline.' + lang + '.html', {
      court: data.court,
      caseNo: data.caseNo,
      parties: data.parties,
      date: data.date,
      judgeName: data.judgeName,
      evidenceNotes: data.evidenceNotes,
      argumentsNotes: data.argumentsNotes,
      reasoningNotes: data.reasoningNotes,
      findingsPrompt: data.findingsPrompt ?? '—',
      orderPrompt: data.orderPrompt ?? '—',
    }, {
      factsBlock,
      issuesBlock,
    }),
  };
}

function regularBailApplication(data: RegularBailApplicationData, lang: LegalLanguage): DocumentBody {
  return {
    title: lang === 'hi' ? 'धारा 483 बीएनएसएस के अंतर्गत नियमित जमानत आवेदन' : 'Regular Bail Application under Section 483 BNSS',
    lang,
    draft: true,
    body: template('regular-bail-application.' + lang + '.html', {
      court: data.court,
      caseNo: data.caseNo,
      applicant: data.applicant,
      respondent: data.respondent,
      policeStation: data.policeStation,
      charges: data.charges,
      arrestDate: data.arrestDate,
      custodyPeriod: data.custodyPeriod,
      facts: data.facts,
      prayer: data.prayer,
      advocateName: data.advocateName,
      advocateEnrollment: data.advocateEnrollment,
      verifiedBy: data.verifiedBy,
    }, {
      grounds: orderedList(data.grounds?.length ? data.grounds : draftListLines),
      undertakings: unorderedList(data.undertakings?.length ? data.undertakings : draftListLines),
    }),
  };
}

function anticipatoryBailApplication(data: AnticipatoryBailApplicationData, lang: LegalLanguage): DocumentBody {
  return {
    title: lang === 'hi' ? 'धारा 482 बीएनएसएस के अंतर्गत अग्रिम जमानत आवेदन' : 'Anticipatory Bail Application under Section 482 BNSS',
    lang,
    draft: true,
    body: template('anticipatory-bail-application.' + lang + '.html', {
      court: data.court,
      applicant: data.applicant,
      respondent: data.respondent,
      policeStation: data.policeStation,
      allegedOffences: data.allegedOffences,
      apprehensionReason: data.apprehensionReason,
      facts: data.facts,
      prayer: data.prayer,
      advocateName: data.advocateName,
      advocateEnrollment: data.advocateEnrollment,
      verifiedBy: data.verifiedBy,
    }, {
      grounds: orderedList(data.grounds?.length ? data.grounds : draftListLines),
      undertakings: unorderedList(data.undertakings?.length ? data.undertakings : draftListLines),
    }),
  };
}

function legalNotice(data: LegalNoticeData, lang: LegalLanguage): DocumentBody {
  return {
    title: lang === 'hi' ? 'विधिक मांग सूचना (Legal Notice)' : 'Legal Notice',
    lang,
    draft: true,
    body: template('legal-notice.' + lang + '.html', {
      date: data.date,
      sender: data.sender,
      senderAddress: data.senderAddress,
      recipient: data.recipient,
      recipientAddress: data.recipientAddress,
      advocateName: data.advocateName,
      advocateAddress: data.advocateAddress,
      advocateContact: data.advocateContact,
      transactionFacts: data.transactionFacts,
      defaultDetails: data.defaultDetails,
      claimAmount: data.claimAmount,
      curePeriodDays: data.curePeriodDays,
      consequences: data.consequences,
    }),
  };
}

function chequeBounceNotice(data: ChequeBounceNoticeData, lang: LegalLanguage): DocumentBody {
  return {
    title: lang === 'hi' ? 'धारा 138 एन.आई. एक्ट के अंतर्गत सांविधिक सूचना' : 'Notice under Section 138 Proviso (b) NI Act',
    lang,
    draft: true,
    body: template('cheque-bounce-notice.' + lang + '.html', {
      date: data.date,
      drawer: data.drawer,
      drawerAddress: data.drawerAddress,
      payee: data.payee,
      payeeAddress: data.payeeAddress,
      advocateName: data.advocateName,
      advocateAddress: data.advocateAddress,
      chequeNo: data.chequeNo,
      chequeDate: data.chequeDate,
      chequeAmount: data.chequeAmount,
      draweeBank: data.draweeBank,
      presentationDate: data.presentationDate,
      returnDate: data.returnDate,
      returnReason: data.returnReason,
      memoReceiptDate: data.memoReceiptDate,
      demandPeriodDays: 15,
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
  INTERIM_ORDER_SHEET: interimOrderSheet,
  NOTICE_TO_APPEAR: noticeToAppear,
  ADJOURNMENT_ORDER: adjournmentOrder,
  JUDGMENT_OUTLINE: judgmentOutline,
  REGULAR_BAIL_APPLICATION: regularBailApplication,
  ANTICIPATORY_BAIL_APPLICATION: anticipatoryBailApplication,
  LEGAL_NOTICE: legalNotice,
  CHEQUE_BOUNCE_NOTICE: chequeBounceNotice,
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
