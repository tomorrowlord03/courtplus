import { useState, type ReactNode } from 'react';
import {
  HINT_LABEL, type CaseRecord, type HintDecision, type HintKind, type HintResult, type PrecedentHit, type RoleHint, type SectionSuggestion,
} from '@courtplus/contracts';
import { btn, btnPrimary, ErrorNote, errMsg } from './ui';
import { caseHintText, researchApi, splitSentences, unavailableText } from '../lib/research';

// Decision support for the judge: suggested sections, similar past cases and the case structure.
// Hints only, each with its source. No verdict, outcome or probability is shown or computed.

type Hints = {
  sections: HintResult<SectionSuggestion>;
  precedents: HintResult<PrecedentHit>;
  roles: HintResult<RoleHint>;
};
type Decisions = Record<string, HintDecision['decision']>;

const ROLE_NAMES: Record<string, string> = {
  facts: 'Facts', issue: 'Issue', ratio: 'Reasoning', ruling: 'Ruling by the court', precedent: 'Precedent cited',
  statute: 'Law cited', arguments_petitioner: 'Petitioner’s argument', arguments_respondent: 'Respondent’s argument',
  argument: 'Argument', other: 'Other',
};

export function HintsPanel({ record }: { record: CaseRecord }) {
  const [text, setText] = useState(() => caseHintText(record));
  const [hints, setHints] = useState<Hints | null>(null);
  const [decisions, setDecisions] = useState<Decisions>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const facts = text.trim();
    if (!facts) return;
    setBusy(true); setError(null);
    try {
      const api = researchApi();
      const sentences = splitSentences(facts);
      const [sections, precedents, roles] = await Promise.all([
        api.suggestSections(facts),
        api.searchPrecedents({ query: facts.slice(0, 2000), k: 5 }),
        sentences.length ? api.classifyRoles(sentences) : Promise.resolve({ available: true as const, items: [] }),
      ]);
      setHints({ sections, precedents, roles });
    } catch (e) { setError(errMsg(e)); }
    finally { setBusy(false); }
  }

  async function decide(kind: HintKind, hintId: string, label: string, source: string, decision: HintDecision['decision']) {
    setError(null);
    try {
      await researchApi().logHint({ caseId: record.id, kind, hintId, label, source, decision });
      setDecisions(current => ({ ...current, [hintId]: decision }));
    } catch (e) { setError(errMsg(e)); }
  }

  const item = (kind: HintKind, hintId: string, label: string, source: string, body: ReactNode) =>
    <li key={hintId} className="hint-item">
      <div>{body}</div>
      <p className="text-xs muted">Source: {source} · <strong className="hint-label">{HINT_LABEL}</strong></p>
      {decisions[hintId]
        ? <p className="text-sm" role="status">{decisions[hintId] === 'accepted' ? '✓ Accepted' : '✗ Dismissed'} (logged)</p>
        : <div className="flex gap-2">
          <button className={btn} type="button" onClick={() => void decide(kind, hintId, label, source, 'accepted')} aria-label={`Accept ${label}`}>Accept</button>
          <button className={btn} type="button" onClick={() => void decide(kind, hintId, label, source, 'dismissed')} aria-label={`Dismiss ${label}`}>Dismiss</button>
        </div>}
    </li>;

  return <section aria-labelledby="hints-title" className="order-3 rounded border bg-white p-3 hints-panel">
    <h2 id="hints-title" className="text-lg font-semibold">Hints for this case</h2>
    <p className="text-sm text-slate-600">{HINT_LABEL}. Hints point to law and past judgments with their source; they never suggest a verdict or an outcome.</p>
    <label className="mt-2 block text-sm font-medium">Case facts used for hints
      <textarea className="field-control mt-1 w-full" rows={4} maxLength={100_000} value={text} onChange={event => setText(event.target.value)} />
    </label>
    <button className={btnPrimary + ' mt-2'} type="button" disabled={busy || !text.trim()} onClick={() => void load()}>
      {busy ? 'Finding hints…' : hints ? 'Refresh hints' : 'Show hints'}
    </button>
    <ErrorNote error={error} />
    {hints && <div className="mt-3 grid gap-3">
      <HintGroup title="Suggested sections" result={hints.sections} empty="No section hints for these facts.">
        {items => items.map(hint => {
          const label = `${hint.act} ${hint.section}`;
          return item('section', `section:${label}`, label, hint.source, <>
            <strong>{label}</strong>{hint.label && hint.label !== label ? ` · ${hint.label}` : ''}
            <span className="block text-sm">{hint.bnsEquivalent ? `BNS equivalent: ${hint.bnsEquivalent}` : hint.bnsNote}</span>
          </>);
        })}
      </HintGroup>
      <HintGroup title="Similar past cases" result={hints.precedents} empty="No similar judgments found.">
        {items => items.map(hit => item('precedent', `precedent:${hit.id}`, hit.citation, hit.source, <>
          <strong>{hit.title}</strong> <span className="text-sm">{hit.citation}{hit.year ? ` · ${hit.year}` : ''} · {hit.court}</span>
          {hit.url && <> · <a className="text-sm" href={hit.url} target="_blank" rel="noreferrer">official copy</a></>}
        </>))}
      </HintGroup>
      <HintGroup title="Case structure" result={hints.roles} empty="Add a few sentences of facts to see their structure.">
        {items => items.map((hint, index) => {
          const role = ROLE_NAMES[hint.role] ?? hint.role;
          return item('structure', `structure:${index}:${hint.role}`, `${role}: ${hint.sentence.slice(0, 80)}`, hint.source, <>
            <strong>{role}</strong> <span className="text-sm">{hint.sentence}</span>
          </>);
        })}
      </HintGroup>
    </div>}
  </section>;
}

function HintGroup<T>({ title, result, empty, children }: {
  title: string; result: HintResult<T>; empty: string; children: (items: T[]) => ReactNode;
}) {
  return <div aria-label={title} role="group">
    <h3 className="font-semibold">{title}</h3>
    {!result.available ? <p className="text-sm partial-note" role="status">{unavailableText(result.reason)}</p>
      : result.items.length ? <ul className="space-y-2">{children(result.items)}</ul>
        : <p className="text-sm text-slate-600">{empty}</p>}
  </div>;
}
