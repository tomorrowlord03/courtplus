import type { Card, CaseRecord, ISODate, Lane, Person } from '@courtplus/contracts' with { 'resolution-mode': 'import' };
import type * as Engine from '@courtplus/engine' with { 'resolution-mode': 'import' };

const laneTitles: Record<Lane, string> = {
  APPLY_NOW: 'Apply now',
  DUE_30: 'Due in 30 days',
  LAWYER_REVIEW: 'Lawyer review',
  BAIL_NOT_RELEASED: 'Bail granted, still in jail',
  COURT_JAIL_MISMATCH: 'Court and jail records disagree',
  NO_UPDATE_180: 'No court update for 180 days',
};

export type CardPatch = Pick<Partial<Card>, 'owner' | 'dueOn' | 'state'>;
export const defaultDailyCap = 10;
export const cardSteps: readonly Card['state'][] = [
  'open', 'assigned', 'order_verified', 'jail_acknowledged', 'holds_checked', 'closed',
];

/** A card moves one step at a time; only the jail superintendent may record the jail's acknowledgement. */
export function checkCardStep(card: Card, patch: CardPatch, role: string): void {
  if (patch.state === undefined || patch.state === card.state) return;
  const next = cardSteps[cardSteps.indexOf(card.state) + 1];
  if (patch.state !== next) throw new Error('Cards move one step at a time. Choose the next step.');
  if (next === 'jail_acknowledged' && role !== 'superintendent') {
    throw new Error('Only the jail superintendent can record the jail’s acknowledgement.');
  }
}

export function indiaDate(now = new Date()): ISODate {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(now);
}

export function buildBoard(
  engine: Pick<typeof Engine, 'screen' | 'explain'>,
  people: readonly Person[],
  cases: CaseRecord[],
  asOf: ISODate,
  patches: ReadonlyMap<string, CardPatch>,
  dailyCap: number,
) {
  const personById = new Map(people.map(person => [person.id, person]));
  const cards: Card[] = [];
  const stale: { card: Card; appellant: boolean; lastUpdate: string }[] = [];

  for (const record of cases) {
    const person = personById.get(record.personId);
    if (!person) continue;
    const result = engine.screen(person, cases, record.id, asOf);
    const tags = result.nalsaCategories.map(category => 'NALSA ' + category);
    if (result.antilCategory) tags.push('Antil ' + result.antilCategory);

    for (const step of engine.explain(result)) {
      if (!step.key.startsWith('lane.')) continue;
      const lane = step.key.slice('lane.'.length) as Lane;
      const id = lane + ':' + record.id;
      const dueOn = lane === 'DUE_30' ? result.thresholdDate
        : lane === 'BAIL_NOT_RELEASED' ? result.alerts.find(alert => alert.kind === 'POST_BAIL_7_DAYS')?.dueOn
        : lane === 'NO_UPDATE_180' ? result.alerts.find(alert => alert.kind === 'NO_COURT_UPDATE_180')?.dueOn
        : undefined;
      const card: Card = {
        id, lane, personId: person.id, caseId: record.id,
        title: person.alias + ' · ' + laneTitles[lane], state: 'open', tags, dueOn, ...patches.get(id),
      };
      if (lane === 'NO_UPDATE_180') {
        const lastUpdate = dueOn ?? record.events.reduce((last, event) =>
          event.on <= asOf && event.on > last ? event.on : last, '');
        stale.push({ card, appellant: person.prisonerType === 'convict_appellant', lastUpdate });
      } else {
        cards.push(card);
      }
    }
  }

  const queue = stale.filter(({ card }) => card.state !== 'closed')
    .sort((a, b) => Number(b.appellant) - Number(a.appellant)
      || a.lastUpdate.localeCompare(b.lastUpdate) || a.card.id.localeCompare(b.card.id));
  const daysToClear = Math.ceil(queue.length / dailyCap);
  return {
    queue: { dailyCap, daysToClear, remaining: queue.length },
    all: [...cards, ...stale.map(({ card }) => card)],
    visible: [...cards, ...queue.slice(0, dailyCap).map(({ card }) => ({
      ...card, tags: [...card.tags, queue.length + ' remaining · ' + daysToClear + ' days to clear'],
    }))],
  };
}
