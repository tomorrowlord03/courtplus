import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkHtml, printDraft, renderHtml, supportedLanguages, type DraftKind } from '../src/index.js';
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
    ];
    for (const html of examples) {
      expect(html).not.toContain('<script>');
      expect(html).toContain(escaped);
    }
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
