import { useState } from 'react';
import { todayIST, useApp } from '../lib/context';
import { ErrorNote, Page, btnPrimary, errMsg } from '../components/ui';

export function ScReturn() {
  const { api } = useApp();
  const [asOf, setAsOf] = useState(todayIST());
  const [path, setPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const go = async (format: 'xlsx' | 'csv') => {
    setError(null); setPath(null);
    try { setPath(await api.exportScReturn(asOf, format)); } catch (e) { setError(errMsg(e)); }
  };

  return (
    <Page title="Supreme Court reporting spreadsheet">
      <p className="mb-3 rounded bg-amber-50 p-3 text-sm">
        ▲ Provisional format. The columns follow the Supreme Court order of 19 Nov 2024 as read by this tool.
        Check against the latest official format before sending.
      </p>
      <ErrorNote error={error} />
      <label className="block">As of date
        <input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} className="ml-2 rounded border px-2 py-1" />
      </label>
      <div className="mt-3 flex gap-2">
        <button className={btnPrimary} onClick={() => void go('xlsx')}>Export .xlsx</button>
        <button className={btnPrimary} onClick={() => void go('csv')}>Export .csv</button>
      </div>
      {path && <p role="status" className="mt-3 break-all">Saved: {path}</p>}
    </Page>
  );
}
