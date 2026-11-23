import { useId, type ReactNode } from 'react';
import help from '../../../../data/ui/screen-help.json';
import { useApp } from '../lib/context';
import { ui } from '../lib/i18n';

const screens = new Map(help.screens.map(screen => [screen.id, screen]));

type IntroProps = {
  screenId: string;
  title?: string;
  note?: string;
  headingId?: string;
  judgeHint?: boolean;
};

export function ScreenIntro({ screenId, title, note, headingId, judgeHint }: IntroProps) {
  const { language } = useApp();
  const screen = screens.get(screenId);
  if (!screen) return null;
  const lang = language === 'hi' ? 'hi' : 'en';

  return <header data-guide-screen={screen.id}>
    <h1 id={headingId} className="text-2xl font-bold">{title ?? screen.name[lang]}</h1>
    {note && <p className="page-note">{note}</p>}
    <dl className="panel mt-4 grid gap-2 sm:grid-cols-[max-content_1fr]">
      <dt className="font-semibold">{ui('What this does')}</dt>
      <dd>{screen.what[lang]}</dd>
      <dt className="font-semibold">{ui('When to use it')}</dt>
      <dd>{screen.when[lang]}</dd>
      <dt className="font-semibold">{ui('Start here')}</dt>
      <dd>{screen.start[lang]}</dd>
    </dl>
    {judgeHint && <p className="page-note">{ui('Hint - the judge decides')}</p>}
  </header>;
}

export function ScreenPage({ children, ...intro }: Omit<IntroProps, 'headingId'> & { children: ReactNode }) {
  const headingId = useId();
  return <section className="page" aria-labelledby={headingId}>
    <ScreenIntro {...intro} headingId={headingId} />
    <div className="mt-4">{children}</div>
  </section>;
}
