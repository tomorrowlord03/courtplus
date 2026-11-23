import type { CaseRecord, CourtPlusApi, ISODate, Person } from '@courtplus/contracts' with { 'resolution-mode': 'import' };
import { join } from 'node:path';
import type { Store } from '../store';
import { createAnchor } from './anchor';
import { buildBoard, checkCardStep, indiaDate } from './board';
import { createCloud } from './cloud';
import { loadFigures } from './documents';
import { createExports } from './exports';
import { readSettings } from './settings';

interface HandlerPorts {
  resourceDirectory: string;
  boardChanged: () => void;
  folder: () => Promise<string | undefined>;
  savePath: (basename: string) => Promise<string | undefined>;
  print: (html: string) => Promise<Uint8Array>;
}

export async function createHandlers(store: Store, ports: HandlerPorts) {
  const [engine, exports] = await Promise.all([import('@courtplus/engine'), import('@courtplus/export')]);
  const cloud = createCloud(store, ports.boardChanged);
  const desktopSettings = () => readSettings(store);
  let boardDate: ISODate | undefined;

  function listCases(): CaseRecord[] {
    const cases = store.listCases();
    const ids = new Set(cases.map(record => record.id));
    return [...cases, ...cloud.records().map(([, record]) => record).filter(record => !ids.has(record.id))];
  }

  function listPersons(): Person[] {
    const people = new Map(store.listPersons().map(person => [person.id, person]));
    for (const [person] of cloud.records()) if (!people.has(person.id)) people.set(person.id, person);
    return [...people.values()];
  }

  function context(caseId: string) {
    const cases = listCases();
    const record = cases.find(item => item.id === caseId);
    const person = record && listPersons().find(item => item.id === record.personId);
    if (!record || !person) throw new Error('Case not found.');
    return { cases, record, person };
  }

  function board(asOf: ISODate) {
    const people = listPersons();
    const cases = listCases();
    const localIds = new Set(store.listCases().map(record => record.id));
    const generated = buildBoard(engine, people, cases.filter(record => localIds.has(record.id)), asOf,
      store.readCards(), desktopSettings().dailyCap);
    const received = cloud.cards(asOf, people, cases).map(cloud.handoffState);
    return { queue: generated.queue, all: [...generated.all, ...received], visible: [...generated.visible, ...received] };
  }

  const { signer, ...exportHandlers } = createExports(store, engine, exports, {
    ...ports, localizationRoot: ports.resourceDirectory,
  }, cloud, context, listCases);
  const anchor = createAnchor(store, exports, { ...ports, localizationRoot: ports.resourceDirectory });
  const handlers: CourtPlusApi = {
    listPersons: async () => listPersons(),
    listCases: async () => listCases(),
    role: async () => {
      const role = cloud.status().role;
      return role === 'admin' || role === 'utrc_member' ? 'utrc' : role ?? store.role();
    },
    importOrder: async file => {
      const intake = await import('@courtplus/intake');
      const order = await intake.importOrder(file, join(ports.resourceDirectory, 'model'));
      store.recordDocument(order, [...new Set(order.suggestions.map(suggestion => suggestion.field))]);
      return order;
    },
    saveCase: async (person, record) => {
      if (cloud.records().some(([, remote]) => remote.id === record.id) && !store.listCases().some(item => item.id === record.id)) {
        throw new Error('Save edits to this case in the issuing office.');
      }
      store.saveCase(person, record);
      cloud.schedule();
    },
    screen: async (caseId, asOf) => {
      const { person, cases } = context(caseId);
      return engine.screen(person, cases, caseId, asOf);
    },
    board: async asOf => {
      boardDate = asOf;
      return board(asOf).visible;
    },
    updateCard: async (id, patch) => {
      if (Object.keys(patch).some(key => !['owner', 'dueOn', 'state'].includes(key))) {
        throw new Error('Only a card’s owner, due date and state can change.');
      }
      const card = board(boardDate ?? indiaDate()).all
        .find(item => item.id === id);
      if (!card) throw new Error('Card not found.');
      if (id.startsWith('handoff:')) return cloud.updateHandoff(card, patch);
      checkCardStep(card, patch, await handlers.role());
      const updated = store.updateCard(card, patch);
      cloud.schedule();
      if (card.lane === 'NO_UPDATE_180' && updated.state === 'closed') ports.boardChanged();
      return updated;
    },
    stats: async () => ({
      peopleCount: listPersons().length, caseCount: listCases().length,
      figures: loadFigures(join(ports.resourceDirectory, 'data', 'stats')),
    }),
    ...exportHandlers,
  };

  return { handlers, cloud, signer, anchor, boardQueue: (asOf: ISODate) => board(asOf).queue };
}
