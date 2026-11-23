import { useApp } from '../lib/context';
import { ui } from '../lib/i18n';
import { UI_LANGUAGES } from '../lib/preferences';

export function DisplayControls() {
  const { language, setLanguage } = useApp();
  return <div className="display-controls" role="group" aria-label={ui('Display preferences')}>
    <label className="view-control interface-language">
      <span className="sr-only">{ui('App language')}</span>
      <select value={language} onChange={event => setLanguage(event.target.value)}>
        {UI_LANGUAGES.map(([code, name]) => <option key={code} value={code} lang={code}>{name}</option>)}
      </select>
    </label>
  </div>;
}
