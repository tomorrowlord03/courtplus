import type { PublicCaseTrack } from '@courtplus/contracts';
import { t, ui } from '../lib/i18n';

/** Only court-published summaries from the public tracking endpoint reach citizens. */
export function HearingBreakdowns({ record }: { record: PublicCaseTrack }) {
  const published = record.summaries ?? [];
  const dates = [...new Set([
    ...record.hearingDates,
    ...published.map(item => item.hearingDate),
  ])].sort((a, b) => b.localeCompare(a));

  return <section className="mt-4 grid gap-2" aria-label={t('track.hearing.summaries', 'Hearing breakdowns')}>
    <h3 className="font-semibold">{t('track.hearing.summaries', 'Hearing breakdowns')}</h3>
    <p className="text-sm">{t('track.hearing.publicSource', 'Only summaries approved and published by the court are shown here. Check the official court order for decisions and deadlines.')}</p>
    {!dates.length && <p className="text-sm">{t('track.noHistory', 'No hearings recorded here yet.')}</p>}
    {dates.map((date, index) => {
      const summaries = published.filter(item => item.hearingDate === date);
      return <details key={date} className="rounded border p-3" open={index === 0}>
        <summary className="font-medium">{ui('Hearing')} · <time dateTime={date}>{date}</time></summary>
        {summaries.length ? summaries.map((item, itemIndex) => <article key={itemIndex} className="mt-2 text-sm">
          {item.verification === 'valid' ? <>
            <p className="font-semibold">{t('track.hearing.verified', 'Verified by the court')}</p>
            <p>{item.summary}</p>
            {item.nextDate && <p>{t('track.next', 'Next date')}: {item.nextDate}</p>}
          </> : <p>{t('track.hearing.invalid', 'Signature could not be verified. Check the official court order.')}</p>}
        </article>) : <p className="mt-2 text-sm">{t('track.noSummaries', 'The court has not published a signed hearing summary for this hearing.')}</p>}
      </details>;
    })}
  </section>;
}
