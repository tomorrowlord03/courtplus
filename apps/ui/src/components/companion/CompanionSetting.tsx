import { ui } from '../../lib/i18n';
import { useCompanionText } from './i18n';
import { useCompanionEnabled } from './store';

export function CompanionSetting() {
  const [enabled, setEnabled] = useCompanionEnabled();
  const t = useCompanionText();

  return (
    <section
      className="grid gap-2 rounded border bg-white p-4"
      aria-label={t('companion.settingTitle', 'Guide companion')}
      data-companion-setting="true"
    >
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="font-semibold text-slate-900">
            {t('companion.settingTitle', 'Guide companion')}
          </h2>
          <p className="text-sm text-slate-600">
            {t(
              'companion.settingDesc',
              'Self-running tour and interactive helper. Explains the app without giving legal advice.'
            )}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          data-guide="start"
          aria-checked={enabled}
          aria-label={
            enabled
              ? t('companion.enabled', 'Guide companion: On')
              : t('companion.disabled', 'Guide companion: Off')
          }
          className={`button ${enabled ? 'primary' : 'secondary'} text-sm whitespace-nowrap`}
          onClick={() => setEnabled(!enabled)}
        >
          {enabled
            ? t('companion.enabled', 'Guide companion: On')
            : t('companion.disabled', 'Guide companion: Off')}
        </button>
      </div>
      <p className="text-sm text-slate-600">{ui('Off: no tour, no spoken guide, and the on-device model is never used.')}</p>
      <p className="text-sm text-slate-600">{ui('Help answers use a small model that runs on this computer. Nothing is sent online.')}</p>
    </section>
  );
}
