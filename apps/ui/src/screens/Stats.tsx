import { useEffect, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useApp } from '../lib/context';
import { Empty, ErrorNote, Page, errMsg } from '../components/ui';

// api.stats() is typed unknown in the contract; we accept this shape and ignore anything else.
export interface Figure { label: string; value: number; source: string; date: string }

export function parseFigures(raw: unknown): Figure[] {
  const list = (raw as { figures?: unknown } | null)?.figures;
  if (!Array.isArray(list)) return [];
  return list.filter((f): f is Figure =>
    !!f && typeof f.label === 'string' && typeof f.value === 'number' && typeof f.source === 'string' && typeof f.date === 'string');
}

export function Stats() {
  const { api } = useApp();
  const [figs, setFigs] = useState<Figure[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api.stats().then((r) => setFigs(parseFigures(r)), (e) => setError(errMsg(e))); }, [api]);

  return (
    <Page title="Statistics">
      <ErrorNote error={error} />
      {figs && figs.length === 0 && <Empty title="No statistics yet" hint="Figures appear once cases are imported and official sources are loaded." />}
      {figs && figs.length > 0 && (
        <>
          <div className="h-72 rounded border bg-white p-2" role="img" aria-label="Bar chart of figures; the table below has the same numbers">
            <ResponsiveContainer>
              <BarChart data={figs}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="label" /><YAxis /><Tooltip />
                <Bar dataKey="value" fill="#1d4ed8" />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <table className="mt-4 w-full text-sm">
            <thead><tr className="text-left"><th>Figure</th><th>Value</th><th>Source</th><th>As of</th></tr></thead>
            <tbody>
              {figs.map((f) => <tr key={f.label} className="border-t"><td>{f.label}</td><td>{f.value}</td><td>{f.source}</td><td>{f.date}</td></tr>)}
            </tbody>
          </table>
        </>
      )}
    </Page>
  );
}
