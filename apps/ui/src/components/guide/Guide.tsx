import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useApp } from '../../lib/context';
import { ui } from '../../lib/i18n';
import { useRole } from '../../lib/roles';
import type { DesktopPreloadApi } from '@courtplus/contracts';
import { isCompanionEnabled, useCompanionEnabled } from '../companion/store';
import { passages, searchGuide, type GuidePassage, type Localized } from '../../lib/guide-search';
import './guide.css';

export type ScreenHelp = { id: string; route: string; roles: string[]; name: Localized; what: Localized; when: Localized; start: Localized; steps: Localized[] };
type ScreenData = { screens: ScreenHelp[] };
// The shared data file is supplied separately. An empty glob keeps this branch buildable until it arrives.
const screenModules = import.meta.glob<ScreenData>('../../../../../data/ui/screen-help.json', { eager: true, import: 'default' });
const bundledScreens = Object.values(screenModules)[0]?.screens ?? [];

type GuideBridge = Partial<Pick<DesktopPreloadApi, 'guideAsk' | 'guideCancel'>>;
const bridge = () => (window as Window & { courtplus?: GuideBridge }).courtplus;
const doneKey = (role: string) => `courtplus.guide.tourDone.${role}`;
const startedKey = 'courtplus.guide.started';
const read = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
const write = (key: string) => { try { localStorage.setItem(key, 'yes'); } catch { /* Storage can be disabled. */ } };
const label = (text: Localized, lang: string) => text[lang === 'hi' ? 'hi' : 'en'] || text.en;
const matches = (route: string, path: string) => route === path || (route.includes(':') && new RegExp('^' + route.replace(/:[^/]+/g, '[^/]+') + '$').test(path));

type GuideProps = {
  screens?: ScreenHelp[];
  autoStartTour?: boolean;
  renderCompanion?: (open: boolean) => ReactNode;
};

export function Guide({ screens = bundledScreens, autoStartTour = true, renderCompanion }: GuideProps) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const roleGroup = useRole();
  const { language, profile } = useApp();
  const role = profile?.role === 'jail_superintendent' ? 'staff' : roleGroup;
  const lang = language === 'hi' ? 'hi' : 'en';
  const [companionEnabled] = useCompanionEnabled();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'screen' | 'tour' | 'ask'>('screen');
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<'nav' | 'start'>('nav');
  const [touring, setTouring] = useState(false);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<string | null>(null);
  const [hits, setHits] = useState<GuidePassage[]>([]);
  const [used, setUsed] = useState<string[]>([]);
  const [thinking, setThinking] = useState(false);
  const request = useRef(0);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  const current = useMemo(() => screens.find(screen => matches(screen.route, pathname)), [screens, pathname]);
  const tour = useMemo(() => screens.filter(screen => screen.roles.includes(role)), [screens, role]);
  const step = tour[index];

  useEffect(() => {
    if (read(startedKey) !== null) return;
    write(startedKey);
    if (isCompanionEnabled() || !autoStartTour || !tour.length || read(doneKey(role)) !== null) return;
    setTab('tour'); setOpen(true); setTouring(true); setIndex(0); setPhase('nav');
  }, [autoStartTour, role, tour.length]);

  useEffect(() => {
    if (open) panel.current?.focus();
  }, [open]);

  useEffect(() => {
    document.querySelectorAll('.guide-highlight').forEach(element => element.classList.remove('guide-highlight'));
    if (!open || !touring || !step) return;
    const screenId = step.id === 'judge-dashboard' ? 'dashboard' : step.id;
    let highlighted: Element | null = null;
    const updateHighlight = () => {
      const intro = document.querySelector(`[data-guide-screen="${screenId}"]`);
      const target = phase === 'nav'
        ? document.querySelector(`.app-sidebar a[href="${step.route}"]`)
        : intro?.closest('.page')?.querySelector('[data-guide="start"]') ?? intro;
      if (target === highlighted) return;
      highlighted?.classList.remove('guide-highlight');
      highlighted = target ?? null;
      highlighted?.classList.add('guide-highlight');
      highlighted?.scrollIntoView?.({ block: 'nearest' });
    };
    updateHighlight();

    const main = document.querySelector('main');
    const observer = new MutationObserver(updateHighlight);
    if (phase === 'start' && main) observer.observe(main, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      highlighted?.classList.remove('guide-highlight');
    };
  }, [open, touring, step, phase, pathname]);

  useEffect(() => {
    if (companionEnabled) return;
    if (thinking) {
      request.current++;
      void bridge()?.guideCancel?.()?.catch(() => {});
      setThinking(false);
    }
    setAnswer(null);
    setUsed([]);
  }, [companionEnabled, thinking]);

  const finish = () => { write(doneKey(role)); setTouring(false); setPhase('nav'); };
  const next = () => {
    if (!step) return;
    if (phase === 'nav') { navigate(step.route); setPhase('start'); return; }
    if (index + 1 === tour.length) { finish(); return; }
    setIndex(index + 1); setPhase('nav');
  };
  const back = () => {
    if (phase === 'start') { setPhase('nav'); return; }
    if (index > 0) { setIndex(index - 1); setPhase('start'); navigate(tour[index - 1].route); }
  };
  const ask = async (event: React.FormEvent) => {
    event.preventDefault();
    const value = question.trim();
    if (!value) return;
    const serial = ++request.current;
    const results = searchGuide(value, lang);
    setHits(results); setAnswer(null); setUsed([]);
    setThinking(false);
    if (!isCompanionEnabled()) return;
    const guideAsk = bridge()?.guideAsk;
    if (!guideAsk) return;
    setThinking(true);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const response = await Promise.race([
        guideAsk({ question: value, ...(current && { screenId: current.id }), lang, passages: results.map(hit => ({ id: hit.id, title: label(hit.title, lang), text: label(hit.text, lang) })) }),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), 25000); }),
      ]);
      if (serial === request.current && isCompanionEnabled() && response?.answer) {
        setAnswer(response.answer);
        setUsed(response.usedPassageIds.filter(id => results.some(hit => hit.id === id)));
      }
    } catch { /* The local results remain visible. */ }
    finally { if (timer) clearTimeout(timer); if (serial === request.current) setThinking(false); }
  };
  const close = () => { setOpen(false); request.current++; setThinking(false); button.current?.focus(); };

  return <div className="guide-root">
    <button ref={button} className="guide-launch" type="button" aria-label={ui('Need help?')} aria-expanded={open} onClick={() => open ? close() : setOpen(true)}>{ui('Need help?')}</button>
    {open && <aside ref={panel} className="guide-panel" tabIndex={-1} aria-label={ui('Help guide')} onKeyDown={event => { if (event.key === 'Escape') close(); }}>
      <div className="guide-head"><strong>{ui('Help guide')}</strong><button type="button" onClick={close} aria-label={ui('Close help')}>×</button></div>
      <p className="guide-disclaimer">{lang === 'hi' ? 'सहायता मार्गदर्शिका - ऐप समझाता है, कानूनी सलाह नहीं' : 'Help guide - explains the app, not legal advice'}</p>
      <div className="guide-tabs" role="tablist" aria-label={ui('Help topics')}>
        {([['screen', 'What can I do here?', 'यहाँ क्या कर सकते हैं?'], ['tour', 'Show me around', 'मुझे घुमाकर दिखाएँ'], ['ask', 'Ask a question', 'सवाल पूछें']] as const).map(([key, en, hi]) =>
          <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)}>{lang === 'hi' ? hi : en}</button>)}
      </div>
      <div role="tabpanel" className="guide-body">
        {tab === 'screen' && (current ? <><h2>{label(current.name, lang)}</h2><h3>{lang === 'hi' ? 'क्या' : 'What'}</h3><p>{label(current.what, lang)}</p><h3>{lang === 'hi' ? 'कब' : 'When'}</h3><p>{label(current.when, lang)}</p><h3>{lang === 'hi' ? 'कदम' : 'Steps'}</h3><ol>{current.steps.map((item, i) => <li key={i}>{label(item, lang)}</li>)}</ol></> : <p>{lang === 'hi' ? 'इस पृष्ठ के लिए सहायता अभी उपलब्ध नहीं है।' : 'Help for this page is not available yet.'}</p>)}
        {tab === 'tour' && (tour.length ? <><h2>{lang === 'hi' ? 'ऐप का परिचय' : 'App tour'}</h2>{!touring ? <button type="button" onClick={() => { setIndex(0); setPhase('nav'); setTouring(true); }}>{lang === 'hi' ? 'परिचय शुरू करें' : 'Start tour'}</button> : <><p>{index + 1} / {tour.length}: {label(step.name, lang)}</p><p>{phase === 'nav' ? label(step.what, lang) : label(step.start, lang)}</p><div className="guide-actions"><button type="button" onClick={back} disabled={index === 0 && phase === 'nav'}>{lang === 'hi' ? 'पीछे' : 'Back'}</button><button type="button" onClick={next}>{phase === 'start' && index + 1 === tour.length ? (lang === 'hi' ? 'पूरा' : 'Done') : (lang === 'hi' ? 'आगे' : 'Next')}</button><button type="button" onClick={finish}>{lang === 'hi' ? 'छोड़ें' : 'Skip'}</button></div></>}</> : <p>{lang === 'hi' ? 'इस भूमिका के लिए परिचय उपलब्ध नहीं है।' : 'No tour is available for this role.'}</p>)}
        {tab === 'ask' && <><form onSubmit={ask}><label htmlFor="guide-question">{lang === 'hi' ? 'आपका सवाल' : 'Your question'}</label><textarea id="guide-question" value={question} onChange={event => setQuestion(event.target.value)} /><button type="submit">{lang === 'hi' ? 'खोजें' : 'Search'}</button></form>{thinking && <p role="status">{lang === 'hi' ? 'सोच रहे हैं…' : 'Thinking…'}</p>}{answer && <p className="guide-answer">{answer}</p>}{answer && used.map(id => { const hit = passages.find(item => item.id === id); return hit && <p key={id}><a href={`#guide-${id}`}>{label(hit.title, lang)}</a></p>; })}{!thinking && hits.filter(hit => !answer || used.includes(hit.id)).map(hit => <article key={hit.id} id={`guide-${hit.id}`}><h3>{label(hit.title, lang)}</h3><p>{label(hit.text, lang)}</p></article>)}</>}
      </div>
    </aside>}
    {renderCompanion?.(open)}
  </div>;
}
