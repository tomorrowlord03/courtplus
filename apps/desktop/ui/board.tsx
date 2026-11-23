import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Card, Lane } from '@courtplus/contracts';
import { useApp, todayIST } from '../../ui/src/lib/context';
import { Empty, ErrorNote, Page, errMsg } from '../../ui/src/components/ui';

import { shell } from './bridge';

const LANES: { lane: Lane; title: string; hint: string }[] = [
  { lane: 'APPLY_NOW', title: 'Apply now', hint: 'Eligible today' },
  { lane: 'DUE_30', title: 'Due in 30 days', hint: 'Becomes eligible within 30 days' },
  { lane: 'LAWYER_REVIEW', title: 'Needs a lawyer', hint: 'A person must decide' },
  { lane: 'BAIL_NOT_RELEASED', title: 'Bail granted but still in jail', hint: 'Check surety, holds, release' },
  { lane: 'COURT_JAIL_MISMATCH', title: 'Court and jail records disagree', hint: 'Reconcile before acting' },
  { lane: 'NO_UPDATE_180', title: 'No court update for 180 days', hint: 'Ask the court registry' },
];

const STEPS: Card['state'][] = ['open', 'assigned', 'order_verified', 'jail_acknowledged', 'holds_checked', 'closed'];
const STEP_LABEL: Record<Card['state'], string> = {
  open: 'Open', assigned: 'Assigned', order_verified: 'Order verified',
  jail_acknowledged: 'Jail acknowledged', holds_checked: 'Holds checked', closed: 'Closed',
};

function Stepper({ state }: { state: Card['state'] }) {
  const at = STEPS.indexOf(state);
  return (
    <ol aria-label="Progress" className="mt-2 flex flex-wrap gap-1 text-xs">
      {STEPS.map((s, i) => (
        <li
          key={s}
          aria-current={i === at ? 'step' : undefined}
          className={`rounded px-1.5 py-0.5 ${i < at ? 'bg-green-100' : i === at ? 'bg-blue-700 font-bold text-white' : 'bg-slate-100 text-slate-600'}`}
        >
          {i < at ? '✓ ' : ''}{STEP_LABEL[s]}
        </li>
      ))}
    </ol>
  );
}

export function Board() {
  const { api } = useApp();
  const [cards, setCards] = useState<Card[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [queue, setQueue] = useState<Awaited<ReturnType<typeof shell.boardQueue>>>();

  const load = useCallback(() => {
    const today = todayIST();
    void Promise.all([api.board(today), shell.boardQueue(today)]).then(([cards, queue]) => {
      setCards(cards);
      setQueue(queue);
    }, error => setError(errMsg(error)));
  }, [api]);
  useEffect(load, [load]);

  const advance = async (c: Card) => {
    const next = STEPS[Math.min(STEPS.indexOf(c.state) + 1, STEPS.length - 1)];
    try {
      const updated = await api.updateCard(c.id, { state: next });
      setCards((cs) => cs?.map((x) => (x.id === c.id ? updated : x)) ?? null);
    } catch (e) {
      setError(errMsg(e));
    }
  };

  if (cards && cards.length === 0) {
    return (
      <Page title="Action board">
        <Empty title="Nothing to act on yet" hint="Import a court order to begin." to="/import" cta="Import order" />
      </Page>
    );
  }

  return (
    <Page title="Action board" note="Each card is a suggestion for a person to check. Nothing here is a decision.">
      <ErrorNote error={error} />
      {!cards && !error && <p>Loading…</p>}
      {cards && (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {LANES.map(({ lane, title, hint }) => {
            const inLane = cards.filter((c) => c.lane === lane);
            return (
              <section key={lane} aria-label={title} className="rounded-lg border bg-white p-3">
                <h2 className="font-semibold">{title} <span className="text-slate-600">({inLane.length})</span></h2>
                <p className="text-xs text-slate-600">{hint}</p>
                {lane === 'NO_UPDATE_180' && queue && (
                  <div className="my-2 rounded bg-amber-50 p-2 text-sm">
                    <Link to="/settings" className="underline">Daily cap: {queue.dailyCap}</Link>
                    <p data-testid="days-to-clear" className="mt-1 font-medium">
                      Days to clear: {queue.daysToClear} ({queue.remaining} remaining)
                    </p>
                  </div>
                )}
                {inLane.length === 0 && <p className="mt-2 text-sm text-slate-600">None.</p>}
                <ul className="mt-2 space-y-2">
                  {inLane.map((c) => (
                    <li key={c.id} className="rounded border p-2 text-sm">
                      <Link to={`/case/${c.caseId}`} className="font-medium text-blue-800 underline">{c.title}</Link>
                      <p className="text-slate-700">
                        Owner: {c.owner ?? 'unassigned'}{c.dueOn ? ` · Due ${c.dueOn}` : ''}
                      </p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {c.tags.filter(tag => !tag.endsWith(' days to clear')).map((tag) => (
                          <span key={tag} className="rounded bg-slate-200 px-1.5 text-xs">{tag}</span>
                        ))}
                      </div>
                      <Stepper state={c.state} />
                      {c.state !== 'closed' && (
                        <button
                          onClick={() => void advance(c)}
                          className="mt-2 rounded border border-slate-400 px-2 py-1 text-xs hover:bg-slate-100"
                        >
                          Mark next step: {STEP_LABEL[STEPS[STEPS.indexOf(c.state) + 1]]}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </Page>
  );
}
