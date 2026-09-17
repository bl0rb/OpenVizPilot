import { EXTENSION_VERSION, MAX_AUTHOR_CONTEXT_CHARS, t, type ModelOption } from '@openvizpilot/shared';
import { MemoryFactsPanel, SavedQueriesPanel, type DashboardPrefs } from '@openvizpilot/ee/extension';
import { useState } from 'preact/hooks';
import { isAllowedBackendUrl, type ExtensionSettings } from '../settings';
import type { EeFeatures } from '../chat/features-client';

/** Ob das explizit zu speichernde Formular vom zuletzt gespeicherten Stand
 * abweicht — pur, damit die Verwerfen-/Weiterbearbeiten-Entscheidung ohne
 * Rendering testbar ist (UI-Review P1-3). */
export function isSettingsDirty(current: ExtensionSettings, saved: ExtensionSettings): boolean {
  return (
    current.backendUrl.trim() !== saved.backendUrl ||
    current.model.trim() !== saved.model ||
    current.apiToken.trim() !== saved.apiToken ||
    current.dashboardContext.trim() !== saved.dashboardContext
  );
}

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
  /** tableau.extensions.environment.mode === 'authoring' — siehe App.tsx.
   * Gemeinsame Workbook-Konfiguration ist nur für Autoren sichtbar/änderbar;
   * Viewer behalten ihre persönlichen Einstellungen (inkl. Modellwahl, die
   * ohnehin nur für die aktuelle Sitzung gilt, siehe settings.ts). */
  isAuthor: boolean;
  /** Per-Dashboard-Präferenzen — siehe PrefsState in App.tsx. */
  prefs: DashboardPrefs | null | 'loading' | 'unavailable' | 'error';
  /** Freigeschaltete Enterprise-Funktionen — steuert, welche Bereiche erscheinen. */
  features: EeFeatures;
  onSave: (settings: ExtensionSettings) => Promise<string | null>;
  onSavePrefs: (prefs: DashboardPrefs) => Promise<string | null>;
  /** Lädt die persönlichen Präferenzen nach einem Ladefehler erneut (siehe SavedQueriesPanel). */
  onReloadPrefs: () => void;
  onClose: () => void;
}) {
  const [backendUrl, setBackendUrl] = useState(props.settings.backendUrl);
  const [model, setModel] = useState(props.settings.model);
  const [apiToken, setApiToken] = useState(props.settings.apiToken);
  const [dashboardContext, setDashboardContext] = useState(props.settings.dashboardContext);
  const [message, setMessage] = useState<string | null>(null);
  const [messageIsError, setMessageIsError] = useState(false);
  const [saving, setSaving] = useState(false);
  // Gezielte Verwerfen-/Weiterbearbeiten-Entscheidung statt stillschweigendem
  // Verwerfen beim Zurückgehen — nur bei tatsächlich ungespeicherten Eingaben
  // (UI-Review P1-3).
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);

  const urlValidation = isAllowedBackendUrl(backendUrl);
  const isDirty = isSettingsDirty({ backendUrl, model, apiToken, dashboardContext }, props.settings);

  const backToChat = () => {
    if (isDirty) {
      setConfirmingDiscard(true);
      return;
    }
    props.onClose();
  };

  const save = async () => {
    if (saving) return;
    if (!urlValidation.ok) {
      setMessage(urlValidation.reason ?? t('settings.invalidBackendUrl'));
      setMessageIsError(true);
      return;
    }
    setSaving(true);
    try {
      const result = await props.onSave({
        backendUrl: backendUrl.trim(),
        model: model.trim(),
        apiToken: apiToken.trim(),
        dashboardContext: dashboardContext.trim(),
      });
      setMessage(result ?? t('settings.saved'));
      setMessageIsError(false);
    } catch (err) {
      // z. B. Tableau lehnt einen zu langen Wert schon in settings.set() ab.
      setMessage(err instanceof Error ? err.message : String(err));
      setMessageIsError(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div class="settings-panel">
      <div class="settings-header">
        <h2>{t('settings.title')}</h2>
        <button type="button" class="btn-secondary" onClick={backToChat}>
          {t('settings.backToChat')}
        </button>
      </div>
      {confirmingDiscard && (
        <div class="settings-message" role="alert">
          <p>{t('settings.discardPrompt')}</p>
          <div class="settings-actions">
            <button type="button" onClick={props.onClose}>
              {t('settings.discardButton')}
            </button>
            <button type="button" class="btn-secondary" onClick={() => setConfirmingDiscard(false)}>
              {t('settings.keepEditingButton')}
            </button>
          </div>
        </div>
      )}
      <p class="field-hint">
        {t('settings.productInfo', undefined, { version: EXTENSION_VERSION })}
        {' · '}
        <a href="https://github.com/bl0rb/OpenVizPilot/wiki" target="_blank" rel="noopener noreferrer">
          {t('settings.helpLink')}
        </a>
      </p>
      {props.isAuthor && (
        <section class="prefs-section">
          <h3>{t('settings.standardAnalysesTitle')}</h3>
          <p>{props.registrationMessage}</p>
          {props.registrationKey && <p class="field-hint">{t('settings.registrationKey', undefined, { key: props.registrationKey })}</p>}
          <button type="button" onClick={() => void props.onResetRegistration()}>{t('settings.resetRegistrationButton')}</button>
          <p class="field-hint">{t('settings.resetRegistrationHint')}</p>
        </section>
      )}
      {props.isAuthor && (
        <section class="prefs-section">
          <h3>{t('settings.authorSectionTitle')}</h3>
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
            <span class="field-hint">{t('settings.apiTokenHint')}</span>
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
        </section>
      )}
      <p class="field-hint">{t('settings.explicitSaveHint')}</p>
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
      {message && (
        <div class="settings-message" role={messageIsError ? 'alert' : 'status'} aria-live={messageIsError ? 'assertive' : 'polite'}>
          {message}
        </div>
      )}
      <div class="settings-actions">
        <button type="button" onClick={() => void save()} disabled={saving}>
          {saving ? t('settings.saving') : t('settings.saveButton')}
        </button>
      </div>

      {/* Persönliche Einstellungen speichern sofort (kein eigener Button) —
          das explizit benennen, damit der Unterschied zum Bereich oben klar
          ist (UI-Review P1-3). */}
      {(props.userId || props.features.memory || props.features.savedQueries) && (
        <p class="field-hint">{t('settings.personalSaveHint')}</p>
      )}

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
        <SavedQueriesPanel prefs={props.prefs} onSavePrefs={props.onSavePrefs} onReloadPrefs={props.onReloadPrefs} />
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
