import { MAX_AUTHOR_CONTEXT_CHARS, t, type ModelOption } from '@openvizpilot/shared';
import { MemoryFactsPanel, SavedQueriesPanel, type DashboardPrefs } from '@openvizpilot/ee/extension';
import { useState } from 'preact/hooks';
import { isAllowedBackendUrl, type ExtensionSettings } from '../settings';
import type { EeFeatures } from '../chat/features-client';

export function SettingsPanel(props: {
  settings: ExtensionSettings;
  registrationMessage: string;
  registrationKey: string | null;
  onResetRegistration: () => Promise<void>;
  models: ModelOption[];
  defaultModel: string;
  backendUrl: string;
  apiToken: string;
  userId: string;
  /** Per-Dashboard-Präferenzen — siehe PrefsState in App.tsx. */
  prefs: DashboardPrefs | null | 'loading' | 'unavailable';
  /** Freigeschaltete Enterprise-Funktionen — steuert, welche Bereiche erscheinen. */
  features: EeFeatures;
  onSave: (settings: ExtensionSettings) => Promise<string | null>;
  onSavePrefs: (prefs: DashboardPrefs) => Promise<string | null>;
  onClose: () => void;
}) {
  const [backendUrl, setBackendUrl] = useState(props.settings.backendUrl);
  const [model, setModel] = useState(props.settings.model);
  const [apiToken, setApiToken] = useState(props.settings.apiToken);
  const [dashboardContext, setDashboardContext] = useState(props.settings.dashboardContext);
  const [message, setMessage] = useState<string | null>(null);

  const urlValidation = isAllowedBackendUrl(backendUrl);

  const save = async () => {
    if (!urlValidation.ok) {
      setMessage(urlValidation.reason ?? t('settings.invalidBackendUrl'));
      return;
    }
    const result = await props.onSave({
      backendUrl: backendUrl.trim(),
      model: model.trim(),
      apiToken: apiToken.trim(),
      dashboardContext: dashboardContext.trim(),
    });
    setMessage(result ?? t('settings.saved'));
  };

  return (
    <div class="settings-panel">
      <h2>{t('settings.title')}</h2>
      <section class="prefs-section">
        <h3>{t('settings.standardAnalysesTitle')}</h3>
        <p>{props.registrationMessage}</p>
        {props.registrationKey && <p class="field-hint">{t('settings.registrationKey', undefined, { key: props.registrationKey })}</p>}
        <button type="button" onClick={() => void props.onResetRegistration()}>{t('settings.resetRegistrationButton')}</button>
        <p class="field-hint">{t('settings.resetRegistrationHint')}</p>
      </section>
      <label>
        {t('settings.backendUrl')}
        <input
          type="text"
          value={backendUrl}
          placeholder={t('settings.backendUrlPlaceholder')}
          onInput={(e) => setBackendUrl((e.target as HTMLInputElement).value)}
        />
        {!urlValidation.ok && <span class="field-error">{urlValidation.reason}</span>}
      </label>
      <label>
        {t('settings.apiToken')}
        <input
          type="password"
          value={apiToken}
          placeholder={t('settings.apiTokenPlaceholder')}
          onInput={(e) => setApiToken((e.target as HTMLInputElement).value)}
        />
      </label>
      <label>
        {t('settings.model')}
        <select value={model} onInput={(e) => setModel((e.target as HTMLSelectElement).value)}>
          <option value="">
            {t('settings.modelDefault', undefined, {
              label: props.models.find((m) => m.id === props.defaultModel)?.label || props.defaultModel || t('settings.modelServerDefault'),
            })}
          </option>
          {props.models.map((m) => (
            <option key={m.id} value={m.id} title={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t('settings.dashboardContext')}
        <textarea
          value={dashboardContext}
          maxLength={MAX_AUTHOR_CONTEXT_CHARS}
          rows={5}
          placeholder={t('settings.dashboardContextPlaceholder')}
          onInput={(e) => setDashboardContext((e.target as HTMLTextAreaElement).value)}
        />
        <span class="field-hint">{t('settings.dashboardContextHint')}</span>
      </label>
      {message && <div class="settings-message">{message}</div>}
      <div class="settings-actions">
        <button type="button" onClick={() => void save()}>
          {t('settings.save')}
        </button>
        <button type="button" class="btn-secondary" onClick={props.onClose}>
          {t('settings.close')}
        </button>
      </div>

      {/* Personalisierung ist Enterprise (ee/): ohne Lizenz erscheinen die Bereiche
          nicht, statt etwas anzubieten, das beim Speichern scheitert. Ausnahme ist
          bereits gespeichertes Memory — das bleibt einsehbar und löschbar. */}
      {props.userId && (
        <MemoryFactsPanel
          backendUrl={props.backendUrl}
          apiToken={props.apiToken}
          userId={props.userId}
          licensed={props.features.memory}
        />
      )}

      {props.userId && props.features.savedQueries && (
        <SavedQueriesPanel prefs={props.prefs} onSavePrefs={props.onSavePrefs} />
      )}

      {/* Ohne Anwenderkennung gibt es keine Personalisierung. Das passiert auf
          Tableau-Versionen vor 2023.2 (Extensions API 1.11), die das Manifest
          bewusst weiter zulässt — dann aber mit Ansage statt stillem Nichts:
          Sonst kauft jemand die Enterprise-Features und sieht nie, warum sie
          fehlen. */}
      {!props.userId && (props.features.memory || props.features.savedQueries) && (
        <section class="prefs-section">
          <h3>{t('settings.personalHeader')}</h3>
          <p class="field-hint">{t('settings.personalHint')}</p>
        </section>
      )}

    </div>
  );
}
