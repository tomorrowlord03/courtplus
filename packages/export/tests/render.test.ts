import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkHtml, printDraft, renderCaseDraft, renderHtml, supportedLanguages, type CaseDraftContext, type DraftKind } from '../src/index.js';
import { drafts } from './fixtures.js';

const payload = '<script>alert("fictional & test")</script>\'';
const escaped = '&lt;script&gt;alert(&quot;fictional &amp; test&quot;)&lt;/script&gt;&#39;';
const kinds = Object.keys(drafts) as DraftKind[];

describe('document rendering', () => {
  it.each(kinds)('renders %s as an entire document in English and Hindi', async (kind) => {
    const english = await printDraft(kind, drafts[kind], 'en', checkHtml);
    expect(english).toContain('<html lang="en" dir="ltr">');
    expect(english).not.toMatch(/\{\{\w+\}\}/);
    if (kind !== 'RIGHTS_CARD') {
      const hindi = await printDraft(kind, drafts[kind], 'hi-IN', checkHtml);
      expect(hindi).toContain('<html lang="hi" dir="ltr">');
      expect(hindi).toContain('Needs review by a fluent legal reader');
      expect(hindi).not.toMatch(/\{\{\w+\}\}/);
    }
  });

  it('prints the application facts, trace, statutory quote and signature fields', () => {
    const html = renderHtml('S479_3_APPLICATION', drafts.S479_3_APPLICATION, 'en');
    for (const text of ['DRAFT', 'Fictional Undertrial A', '120 days', 'Verified by', 'Attested by',
      'The Superintendent of jail', 'Provided further that', 'delay in proceeding caused by the accused']) {
      expect(html).toContain(text);
    }
  });

  it.each(['S479_3_APPLICATION', 'DLSA_7_DAY', 'AI_ASSISTANCE_NOTE'] as const)(
    'prints a bilingual DRAFT watermark for the Hindi %s draft',
    (kind) => {
      expect(renderHtml(kind, drafts[kind], 'hi')).toMatch(/class="watermark"[^>]*>DRAFT \/ प्रारूप<\/div>/);
      expect(renderHtml(kind, drafts[kind], 'en')).toContain('<div class="watermark">DRAFT</div>');
    },
  );

  it('prints the named confirmer, DLSA deadline and handoff anchor', () => {
    const ai = renderHtml('AI_ASSISTANCE_NOTE', drafts.AI_ASSISTANCE_NOTE, 'en');
    expect(ai).toContain('Fictional Reviewer');
    expect(ai).toContain('Date of bail order');
    expect(ai).toContain('is not yet in force');
    expect(renderHtml('DLSA_7_DAY', drafts.DLSA_7_DAY, 'en')).toContain('Seven days have elapsed');
    expect(renderHtml('DLSA_HANDOFF', drafts.DLSA_HANDOFF, 'en')).toContain(drafts.DLSA_HANDOFF.auditLogHead);
  });

  it('escapes template fields and generated HTML fragments', () => {
    const application = renderHtml('S479_3_APPLICATION', {
      ...drafts.S479_3_APPLICATION,
      person: { alias: payload },
      caseRecord: { ...drafts.S479_3_APPLICATION.caseRecord, court: payload },
      result: { ...drafts.S479_3_APPLICATION.result, reasons: [payload] },
    }, 'en');
    expect(application.split(escaped).length - 1).toBe(4);
    const examples = [
      application,
      renderHtml('DLSA_7_DAY', { ...drafts.DLSA_7_DAY, district: payload, releaseBarrier: payload }, 'hi'),
      renderHtml('AI_ASSISTANCE_NOTE', { ...drafts.AI_ASSISTANCE_NOTE, suggestedFields: [payload] }, 'hi'),
      renderHtml('RIGHTS_CARD', { dlsaName: payload }, 'en'),
      renderHtml('DLSA_HANDOFF', { ...drafts.DLSA_HANDOFF, handedOverBy: payload }, 'hi'),
      renderHtml('INTERIM_ORDER_SHEET', { ...drafts.INTERIM_ORDER_SHEET, proceedings: payload }, 'en'),
      renderHtml('NOTICE_TO_APPEAR', { ...drafts.NOTICE_TO_APPEAR, recipientName: payload }, 'hi'),
      renderHtml('ADJOURNMENT_ORDER', { ...drafts.ADJOURNMENT_ORDER, reason: payload }, 'en'),
      renderHtml('JUDGMENT_OUTLINE', { ...drafts.JUDGMENT_OUTLINE, facts: payload }, 'hi'),
      renderHtml('REGULAR_BAIL_APPLICATION', { ...drafts.REGULAR_BAIL_APPLICATION, applicant: payload }, 'en'),
      renderHtml('ANTICIPATORY_BAIL_APPLICATION', { ...drafts.ANTICIPATORY_BAIL_APPLICATION, applicant: payload }, 'hi'),
      renderHtml('LEGAL_NOTICE', { ...drafts.LEGAL_NOTICE, sender: payload }, 'en'),
      renderHtml('CHEQUE_BOUNCE_NOTICE', { ...drafts.CHEQUE_BOUNCE_NOTICE, payee: payload }, 'hi'),
    ];
    for (const html of examples) {
      expect(html).not.toContain('<script>');
      expect(html).toContain(escaped);
    }
  });

  const courtAndLawyerDrafts: DraftKind[] = [
    'INTERIM_ORDER_SHEET',
    'NOTICE_TO_APPEAR',
    'ADJOURNMENT_ORDER',
    'JUDGMENT_OUTLINE',
    'REGULAR_BAIL_APPLICATION',
    'ANTICIPATORY_BAIL_APPLICATION',
    'LEGAL_NOTICE',
    'CHEQUE_BOUNCE_NOTICE',
  ];

  it.each(courtAndLawyerDrafts)('includes the required assistance footer in %s (English & Hindi)', async (kind) => {
    const english = renderHtml(kind, drafts[kind], 'en');
    const hindi = renderHtml(kind, drafts[kind], 'hi');
    const requiredFooter = 'Draft prepared with Court+ assistance - to be checked and signed by the author';
    expect(english).toContain(requiredFooter);
    expect(hindi).toContain(requiredFooter);
  });

  it('renders judge interim order sheet with proceedings of the day, appearances, next date and directions', () => {
    const html = renderHtml('INTERIM_ORDER_SHEET', drafts.INTERIM_ORDER_SHEET, 'en');
    expect(html).toContain('CR/101/2026');
    expect(html).toContain('Witness PW-1 examined in chief');
    expect(html).toContain('Summons to be re-issued to PW-2');
    expect(html).toContain('2026-05-24');
    expect(html).toContain('Public Prosecutor for State');
  });

  it('renders notice to appear for a party/witness with appearance details and purpose', () => {
    const html = renderHtml('NOTICE_TO_APPEAR', drafts.NOTICE_TO_APPEAR, 'en');
    expect(html).toContain('Fictional Witness W');
    expect(html).toContain('2026-05-24');
    expect(html).toContain('10:30 AM');
    expect(html).toContain('To give evidence in the above-captioned matter');
  });

  it('renders adjournment order with suggested reason, requesting party, and next date', () => {
    const html = renderHtml('ADJOURNMENT_ORDER', drafts.ADJOURNMENT_ORDER, 'en');
    expect(html).toContain('Defence Counsel');
    expect(html).toContain('Counsel indisposed due to sudden medical emergency');
    expect(html).toContain('2026-05-20');
    expect(html).toContain('Final arguments');
  });

  it('renders judgment outline with 8 headings, prefilled blocks marked "Draft from case record - verify", and no outcome text', () => {
    const html = renderHtml('JUDGMENT_OUTLINE', drafts.JUDGMENT_OUTLINE, 'en');
    for (const heading of ['Parties', 'Facts', 'Issues', 'Evidence', 'Arguments', 'Reasoning', 'Findings', 'Order']) {
      expect(html).toContain(`<h2>${heading}</h2>`);
    }
    expect(html).toContain('Draft from case record - verify');
    expect(html).toContain('The prosecution alleges that on 2025-10-15');
    expect(html).toContain('Whether the prosecution proved the identity');
    // Findings and Order contain prompts, no outcome verdict text generated
    expect(html).toContain('No automated outcome is generated');
  });

  it('renders regular bail application citing BNSS s.483 with grounds list and undertakings', () => {
    const html = renderHtml('REGULAR_BAIL_APPLICATION', drafts.REGULAR_BAIL_APPLICATION, 'en');
    expect(html).toContain('Section 483 of the Bharatiya Nagarik Suraksha Sanhita, 2023');
    expect(html).toContain('The applicant has clean antecedents');
    expect(html).toContain('The applicant undertakes to attend every date of hearing');
    expect(html).toContain('Fictional Undertrial Applicant');
  });

  it('renders anticipatory bail application citing BNSS s.482 with apprehension reason and grounds', () => {
    const html = renderHtml('ANTICIPATORY_BAIL_APPLICATION', drafts.ANTICIPATORY_BAIL_APPLICATION, 'en');
    expect(html).toContain('Section 482 of the Bharatiya Nagarik Suraksha Sanhita, 2023');
    expect(html).toContain('Notice received under Section 35(3) BNSS');
    expect(html).toContain('No custodial interrogation is required');
  });

  it('renders legal notice with demand fields, claim amount, and cure period', () => {
    const html = renderHtml('LEGAL_NOTICE', drafts.LEGAL_NOTICE, 'en');
    expect(html).toContain('Fictional Claimant Company Ltd.');
    expect(html).toContain('Fictional Debtor Enterprises');
    expect(html).toContain('Rs. 5,50,000/- with interest @ 18% p.a.');
    expect(html).toContain('<bdi>15</bdi> days');
  });

  it('renders cheque bounce notice citing NI Act s.138 proviso (b) with cheque details table and 15 days demand', () => {
    const html = renderHtml('CHEQUE_BOUNCE_NOTICE', drafts.CHEQUE_BOUNCE_NOTICE, 'en');
    expect(html).toContain('SECTION 138 PROVISO (b) OF THE NEGOTIABLE INSTRUMENTS ACT, 1881');
    expect(html).toContain('123456');
    expect(html).toContain('Rs. 2,00,000/- (Rupees Two Lakhs only)');
    expect(html).toContain('Funds Insufficient');
    expect(html).toContain('<bdi>15</bdi> days');
  });
});

describe('prefill from the case record', () => {
  const context: CaseDraftContext = {
    record: {
      id: 'fictional-case', personId: 'fictional-person', court: 'Fictional Court', caseNo: 'FICTIONAL-41',
      pendingStatus: 'trial', custody: [],
      charges: [
        { act: 'BNS', section: '303', verified: true, stage: 'FIR' },
        { act: 'BNS', section: '999', verified: false, stage: 'FIR' },
      ],
      events: [
        { kind: 'hearing', on: '2026-05-11' },
        { kind: 'hearing', on: '2026-05-12', source: { docId: 'fictional-order', verifiedBy: 'Fictional Reviewer' } },
      ],
    },
    today: '2026-05-10',
  };

  it('copies a verified hearing and charge without proposing findings or undertakings', () => {
    const order = renderCaseDraft('INTERIM_ORDER_SHEET', context, 'en');
    expect(order).toContain('FICTIONAL-41');
    expect(order).toContain('2026-05-12');
    expect(order).not.toContain('2026-05-11');
    const bail = renderCaseDraft('REGULAR_BAIL_APPLICATION', context, 'en');
    expect(bail).toContain('BNS 303');
    expect(bail).not.toContain('BNS 999');
    expect(bail).not.toContain('The applicant undertakes');
    expect(bail).toContain('<li dir="auto">________________________________</li>');
  });

  it('marks each confirmed block of the selected case structure for verification', () => {
    const confirmedStructure = { caseId: context.record.id, facts: 'Fictional confirmed facts', issues: ['Fictional confirmed issue'] };
    for (const lang of ['en', 'hi']) {
      const judgment = renderCaseDraft('JUDGMENT_OUTLINE', { ...context, confirmedStructure }, lang);
      expect(judgment.match(/Draft from case record - verify/g)).toHaveLength(2);
      expect(judgment).toContain(confirmedStructure.facts);
      expect(judgment).toContain(confirmedStructure.issues[0]);
    }
    const unrelated = renderCaseDraft('JUDGMENT_OUTLINE', {
      ...context, confirmedStructure: { ...confirmedStructure, caseId: 'fictional-other-case' },
    }, 'en');
    expect(unrelated).not.toContain('Draft from case record - verify');
    expect(unrelated).not.toContain(confirmedStructure.facts);
  });

  it('carries the confirmed adjournment reason and date while leaving the order for the judge', () => {
    const confirmedAdjournment = {
      caseId: context.record.id, party: 'Fictional Party A', date: context.today,
      nextOn: '2026-05-15', purpose: 'Fictional hearing', reason: 'Fictional confirmed reason',
    };
    const order = renderCaseDraft('ADJOURNMENT_ORDER', { ...context, confirmedAdjournment }, 'en');
    expect(order).toContain(confirmedAdjournment.reason);
    expect(order).toContain(confirmedAdjournment.nextOn);
    expect(order).not.toContain('the adjournment is granted');
    const blank = renderCaseDraft('ADJOURNMENT_ORDER', context, 'en');
    expect(blank).not.toContain(confirmedAdjournment.reason);
    expect(blank).not.toContain(confirmedAdjournment.nextOn);
  });
});

describe('rights card localization', () => {
  const out = fileURLToPath(new URL('../out/', import.meta.url));
  let root: string;

  beforeAll(() => {
    mkdirSync(out, { recursive: true });
    root = mkdtempSync(join(out, 'rights-test-'));
    mkdirSync(join(root, 'data', 'i18n'), { recursive: true });
    mkdirSync(join(root, 'assets', 'fonts'), { recursive: true });
    writeFileSync(join(root, 'assets', 'fonts', 'fonts.css'), `
      @font-face { font-family: 'Noto Naskh Arabic'; font-weight: 400; src: url('./fixture.ttf'); }
      @font-face { font-family: 'Noto Sans Tamil'; font-weight: 400; src: url('./unused.ttf'); }
    `);
    writeFileSync(join(root, 'assets', 'fonts', 'fixture.ttf'), 'fictional font bytes');
    writeFileSync(join(root, 'assets', 'fonts', 'unused.ttf'), 'unused fictional font bytes');
    for (const lang of supportedLanguages) {
      writeFileSync(join(root, 'data', 'i18n', lang + '.json'), JSON.stringify({
        rights_card_title: 'Fictional locale ' + lang,
        rights_legal_aid_statutory: 'Fictional legal aid translation',
        rights_bnss_479_release: 'Fictional release translation',
        rights_superintendent_duty: 'Fictional superintendent translation',
        rights_post_bail_7_days: 'Fictional 7-day translation',
        rights_ask_lawyer: payload,
        rights_contact: 'Fictional contact {dlsaName} {dlsaPhone}',
        rights_disclaimer: 'Fictional disclaimer',
        _meta: { machineTranslated: lang !== 'en', reviewed: lang === 'en' },
      }));
    }
  });

  afterAll(() => {
    if (root && dirname(root) === resolve(out)) rmSync(root, { recursive: true });
  });

  it.each(['en', 'hi', 'bn', 'ta', 'te', 'mr', 'gu', 'kn', 'ml', 'pa', 'or', 'as', 'ur'])(
    'uses the %s catalog and escapes catalog and contact text',
    (lang) => {
      const html = renderHtml('RIGHTS_CARD', { dlsaName: payload, dlsaPhone: '0000' }, lang, { localizationRoot: root });
      expect(html).toContain('<html lang="' + lang + '" dir="' + (lang === 'ur' ? 'rtl' : 'ltr') + '">');
      expect(html).toContain('Fictional locale ' + lang);
      expect(html).toContain('Fictional contact ' + escaped + ' 0000');
      expect(html).not.toContain('<script>');
      expect(html.includes('Machine translation')).toBe(lang !== 'en');
    },
  );

  it('embeds only the matching local font and falls back on incomplete or absent translations', () => {
    const options = { localizationRoot: root };
    const urdu = renderHtml('RIGHTS_CARD', {}, 'ur-PK', options);
    expect(urdu).toContain("'Noto Naskh Arabic'");
    expect(urdu).toContain('data:font/ttf;base64,' + Buffer.from('fictional font bytes').toString('base64'));
    expect(urdu).not.toContain(Buffer.from('unused fictional font bytes').toString('base64'));
    writeFileSync(join(root, 'data', 'i18n', 'hi.json'), '{}');
    const fallback = renderHtml('RIGHTS_CARD', {}, 'hi', options);
    expect(fallback).toContain('The requested translation is unavailable');
    expect(fallback).toContain('Fictional locale en');
    expect(renderHtml('RIGHTS_CARD', {}, 'ur', { localizationRoot: join(root, 'missing') }))
      .toContain('Prisoner Legal Rights Card');
  });
});
