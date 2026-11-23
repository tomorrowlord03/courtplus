import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

export function Empty({ title, hint, to, cta }: { title: string; hint?: string; to?: string; cta?: string }) {
  return (
    <div role="status" className="rounded-lg border-2 border-dashed border-slate-300 bg-white p-8 text-center">
      <p className="text-lg font-semibold">{title}</p>
      {hint && <p className="mt-1 text-slate-600">{hint}</p>}
      {to && (
        <Link to={to} className="mt-4 inline-block rounded bg-blue-700 px-4 py-2 font-medium text-white">
          {cta ?? 'Go'}
        </Link>
      )}
    </div>
  );
}

export function Page({ title, children, note }: { title: string; children: ReactNode; note?: string }) {
  return (
    <section aria-labelledby="page-title">
      <h1 id="page-title" className="text-2xl font-bold">{title}</h1>
      {note && <p className="mb-4 mt-1 text-slate-600">{note}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function ErrorNote({ error }: { error: string | null }) {
  return error ? <p role="alert" className="my-2 rounded bg-red-50 p-3 text-red-800">⚠ {error}</p> : null;
}

export const btn = 'rounded border border-slate-400 bg-white px-3 py-1.5 text-sm font-medium hover:bg-slate-100 disabled:opacity-50';
export const btnPrimary = 'rounded bg-blue-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-50';

export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
