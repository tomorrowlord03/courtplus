import { useId, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

export function Empty({ title, hint, to, cta }: { title: string; hint?: string; to?: string; cta?: string }) {
  return (
    <div role="status" className="empty-state">
      <p className="text-lg font-semibold">{title}</p>
      {hint && <p className="mt-1 text-slate-600">{hint}</p>}
      {to && (
        <Link to={to} className={btnPrimary + ' mt-4'}>
          {cta ?? 'Go'}
        </Link>
      )}
    </div>
  );
}

export function Page({ title, children, note }: { title: string; children: ReactNode; note?: string }) {
  const titleId = useId();
  return (
    <section className="page" aria-labelledby={titleId}>
      <h1 id={titleId} className="text-2xl font-bold">{title}</h1>
      {note && <p className="page-note">{note}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function ErrorNote({ error }: { error: string | null }) {
  return error ? <p role="alert" className="my-2 rounded bg-red-50 p-3 text-red-800">⚠ {error}</p> : null;
}

export const btn = 'button secondary';
export const btnPrimary = 'button primary';

export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
