import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { CaseRecord, Person } from '@courtplus/contracts';
import { useApp } from '../lib/context';
import { Empty, ErrorNote, Page, errMsg } from '../components/ui';

function useData() {
  const { api } = useApp();
  const [data, setData] = useState<{ persons: Person[]; cases: CaseRecord[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    Promise.all([api.listPersons(), api.listCases()]).then(([persons, cases]) => setData({ persons, cases }), (e) => setError(errMsg(e)));
  }, [api]);
  return { data, error };
}

export function PersonList() {
  const { data, error } = useData();
  return (
    <Page title="People">
      <ErrorNote error={error} />
      {data && data.persons.length === 0 && <Empty title="No people yet" hint="Import a court order to begin." to="/import" cta="Import order" />}
      <ul className="space-y-1">
        {data?.persons.map((p) => <li key={p.id}><Link className="text-blue-800 underline" to={`/person/${p.id}`}>{p.alias}</Link></li>)}
      </ul>
    </Page>
  );
}

export function PersonView() {
  const { personId } = useParams();
  const { data, error } = useData();
  const person = data?.persons.find((p) => p.id === personId);
  const cases = data?.cases.filter((c) => c.personId === personId) ?? [];
  return (
    <Page title={person ? person.alias : 'Person'}>
      <ErrorNote error={error} />
      {data && !person && <Empty title="Person not found" to="/persons" cta="All people" />}
      {person && (
        <>
          <section className="mb-4 rounded border bg-white p-3" aria-label="Section 479(2)">
            <h2 className="font-semibold">Why more than one case matters (s.479(2) BNSS)</h2>
            <p className="text-sm">
              {cases.length > 1
                ? `${cases.length} cases are recorded for this person. `
                : 'One case is recorded. '}
              The default threshold under s.479(1) is not applied automatically where investigation, inquiry or trial is
              pending in more than one offence or in multiple cases, or where another hold exists. Such a person goes to
              “Needs a lawyer”. When custody reaches the maximum term, an urgent review is still raised.
              A lawyer must confirm every case.
            </p>
          </section>
          <h2 className="font-semibold">Cases</h2>
          {cases.length === 0 && <p className="text-sm text-slate-600">No cases linked.</p>}
          <ul className="space-y-1">
            {cases.map((c) => (
              <li key={c.id}>
                <Link className="text-blue-800 underline" to={`/case/${c.id}`}>{c.caseNo ?? c.cnr ?? c.id}</Link>
                {` · ${c.pendingStatus}`}
              </li>
            ))}
          </ul>
        </>
      )}
    </Page>
  );
}
