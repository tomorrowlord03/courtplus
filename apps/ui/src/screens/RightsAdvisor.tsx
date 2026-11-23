import { useState, type FormEvent } from 'react';
import type { SectionSuggestion } from '@courtplus/contracts';
import { HINT_LABEL } from '@courtplus/contracts';
import { btn, btnPrimary, Page } from '../components/ui';
import { useApp } from '../lib/context';
import { t } from '../lib/i18n';
import { researchApi } from '../lib/research';
// The guides package is pure TypeScript with no I/O; the renderer matches locally.
import { BUILTIN_GUIDES, getGuideById, matchGuides, type Guide, type MatchResult } from '../../../../packages/guides/src/index';

// Rights & action advisor. Not a chatbot: one description in, the best matching official guide out.

export const NALSA_HELPLINE = '15100';
type Lang = 'en' | 'hi';

export function adviseFor(description: string): MatchResult[] {
  return matchGuides(description, BUILTIN_GUIDES, { limit: 5 });
}

export function RightsAdvisor({ title = 'Rights advisor' }: { title?: string }) {
  const { language } = useApp();
  const [lang, setLang] = useState<Lang>(language === 'hi' ? 'hi' : 'en');
  const [matches, setMatches] = useState<MatchResult[] | null>(null);
  const [chosen, setChosen] = useState<Guide | null>(null);
  const [sections, setSections] = useState<SectionSuggestion[]>([]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const description = String(new FormData(event.currentTarget).get('description') ?? '').trim();
    if (!description) return;
    const found = adviseFor(description);
    setMatches(found);
    setChosen(found[0]?.guide ?? null);
    setSections([]);
    // Secondary hint only; ignored when research is not installed.
    void researchApi().suggestSections(description)
      .then(result => setSections(result.available ? result.items.slice(0, 3) : []), () => setSections([]));
  }

  const others = matches?.filter(match => match.guide.id !== chosen?.id) ?? [];
  const fallback = getGuideById('free-legal-aid');

  return <Page title={title} note={t('rights.note', 'Find your rights and the next steps. Not legal advice; free legal aid can help you.')}>
    <form className="panel rights-form" onSubmit={submit}>
      <label htmlFor="rights-description" className="font-medium">{t('rights.describe', 'Describe your problem in your own words')}</label>
      <textarea id="rights-description" name="description" className="field-control" rows={4} maxLength={4000} required
        placeholder={t('rights.placeholder', 'For example: my employer has not paid my salary for three months / मालिक ने तीन महीने से वेतन नहीं दिया')} />
      <div className="flex flex-wrap items-center gap-2">
        <button className={btnPrimary}>{t('rights.find', 'Find my rights and next steps')}</button>
        <LegalAidButton />
        <label className="ml-auto text-sm">{t('rights.showIn', 'Show guide in')}{' '}
          <select className="field-control inline-block w-auto" value={lang} onChange={event => setLang(event.target.value as Lang)}>
            <option value="en">English</option><option value="hi">हिन्दी</option>
          </select>
        </label>
      </div>
    </form>

    {matches && !chosen && <section className="panel mt-4" role="status">
      <p>{t('rights.noMatch', 'We could not match your words to a guide. Try other words, choose a topic below, or call free legal aid.')}</p>
      <TopicChips guides={BUILTIN_GUIDES} lang={lang} onPick={setChosen} label={t('rights.topics', 'Topics')} />
      {fallback && <button className={btn + ' mt-2'} type="button" onClick={() => setChosen(fallback)}>{fallback.title_en}</button>}
    </section>}

    {chosen && <GuideCard guide={chosen} lang={lang} />}

    {others.length > 0 && <section className="mt-4" aria-label="Other matches">
      <TopicChips guides={others.map(match => match.guide)} lang={lang} onPick={setChosen} label={t('rights.oneOfThese', 'Is it one of these?')} />
    </section>}

    {chosen && sections.length > 0 && <section className="panel mt-4" aria-label="Possible sections">
      <h2 className="font-semibold">{t('rights.sections', 'Sections that may apply')}</h2>
      <ul className="text-sm">{sections.map(hint => <li key={hint.act + hint.section}>
        {hint.act} {hint.section}{hint.bnsEquivalent ? ` (BNS ${hint.bnsEquivalent})` : ''} · {hint.source}
      </li>)}</ul>
      <p className="text-xs muted">{HINT_LABEL}: a lawyer or legal-aid clinic should confirm which law applies.</p>
    </section>}
  </Page>;
}

function LegalAidButton() {
  return <a className={btn} href={`tel:${NALSA_HELPLINE}`}>{t('rights.legalAid', `Talk to free legal aid (NALSA ${NALSA_HELPLINE})`)}</a>;
}

function TopicChips({ guides, lang, onPick, label }: { guides: Guide[]; lang: Lang; onPick: (guide: Guide) => void; label: string }) {
  return <div role="group" aria-label={label}>
    <p className="font-medium">{label}</p>
    <div className="flex flex-wrap gap-2">{guides.map(guide =>
      <button key={guide.id} type="button" className="chip" onClick={() => onPick(guide)}>{shortTitle(lang === 'hi' ? guide.title_hi : guide.title_en)}</button>)}
    </div>
  </div>;
}

/** Guide titles carry a subtitle after a colon; chips show the topic only. */
export function shortTitle(title: string): string {
  return title.split(':')[0].trim();
}

function HindiNote({ guide, lang }: { guide: Guide; lang: Lang }) {
  return lang === 'hi' && !guide.hi_reviewed
    ? <span className="hindi-unreviewed" title="Machine or draft Hindi; English is authoritative"> (Hindi not yet reviewed)</span> : null;
}

export function GuideCard({ guide, lang }: { guide: Guide; lang: Lang }) {
  const hi = lang === 'hi';
  const documents = [...new Set(guide.steps.flatMap(step => step.documents_needed))];
  return <article className="panel guide-card mt-4" aria-labelledby={`guide-${guide.id}`}>
    <h2 id={`guide-${guide.id}`} className="text-xl font-semibold">{hi ? guide.title_hi : guide.title_en}<HindiNote guide={guide} lang={lang} /></h2>
    <p className="text-xs muted">{t('rights.checked', 'Last checked')} {guide.last_checked}</p>

    <h3 className="mt-3 font-semibold">{t('rights.yourRights', 'Your rights')}</h3>
    <ul className="space-y-2">{guide.laws.map(law => <li key={law.act + law.section}>
      <strong>{law.act}, {law.section}</strong>: {law.plain_meaning}{' '}
      <a href={law.source_url} target="_blank" rel="noreferrer">{t('rights.source', 'Official text')}</a>
    </li>)}</ul>

    <h3 className="mt-3 font-semibold">{t('rights.steps', 'What to do, step by step')}<HindiNote guide={guide} lang={lang} /></h3>
    <ol className="space-y-2 list-decimal pl-5">{[...guide.steps].sort((a, b) => a.order - b.order).map(step => <li key={step.order}>
      <p>{hi ? step.action_hi : step.action_en}</p>
      <p className="text-sm"><strong>{t('rights.where', 'Where')}:</strong> {step.where}</p>
      {step.deadline_or_limitation && <p className="text-sm"><strong>{t('rights.deadline', 'Deadline')}:</strong> {step.deadline_or_limitation}</p>}
    </li>)}</ol>

    {documents.length > 0 && <>
      <h3 className="mt-3 font-semibold">{t('rights.documents', 'Documents to keep ready')}</h3>
      <ul className="list-disc pl-5 text-sm">{documents.map(document => <li key={document}>{document}</li>)}</ul>
    </>}

    {guide.helplines.length > 0 && <>
      <h3 className="mt-3 font-semibold">{t('rights.helplines', 'Helplines')}</h3>
      <ul className="text-sm">{guide.helplines.map(line => <li key={line.name + line.number}>
        <a href={`tel:${line.number.replace(/[^\d+]/g, '')}`}>{line.number}</a> · {line.name}{line.description ? ` · ${line.description}` : ''}
      </li>)}</ul>
    </>}

    <h3 className="mt-3 font-semibold">{t('rights.freeAid', 'Free legal aid')}</h3>
    <p className="text-sm"><strong>{t('rights.eligible', 'Who can get it')}:</strong> {guide.free_legal_aid.eligible}</p>
    <p className="text-sm"><strong>{t('rights.apply', 'How to apply')}:</strong> {guide.free_legal_aid.how_to_apply} ({guide.free_legal_aid.authority})</p>
    <LegalAidButton />

    {guide.when_to_see_a_lawyer.length > 0 && <>
      <h3 className="mt-3 font-semibold">{t('rights.lawyer', 'When to see a lawyer')}</h3>
      <ul className="list-disc pl-5 text-sm">{guide.when_to_see_a_lawyer.map(item => <li key={item}>{item}</li>)}</ul>
    </>}
    <p className="mt-3 text-xs muted">{t('rights.sources', 'Sources')}: {guide.sources.map((source, index) => <span key={source}>
      {index > 0 && ' · '}{/^https?:/.test(source) ? <a href={source} target="_blank" rel="noreferrer">{new URL(source).hostname}</a> : source}
    </span>)}</p>
  </article>;
}
