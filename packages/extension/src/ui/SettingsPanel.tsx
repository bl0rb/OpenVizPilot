import { EXTENSION_VERSION, MAX_AUTHOR_CONTEXT_CHARS, t, type ModelOption, type SupportedLocale } from '@openvizpilot/shared';
import { MemoryFactsPanel, SavedQueriesPanel, WatchSettingsPanel, type DashboardPrefs } from '@openvizpilot/ee/extension';
import { useEffect, useRef, useState } from 'preact/hooks';
import { TOOL_ROUNDS_BY_MODE } from '../chat/agent-loop';
import {
  MAX_TOOL_ROUNDS_SETTING,
  MIN_TOOL_ROUNDS,
  isAllowedBackendUrl,
  isValidMaxToolRounds,
  type ExtensionSettings,
} from '../settings';
import type { EeFeatures } from '../chat/features-client';

/** Ob das explizit zu speichernde Formular vom zuletzt gespeicherten Stand
 * abweicht — pur, damit die Verwerfen-/Weiterbearbeiten-Entscheidung ohne
 * Rendering testbar ist (UI-Review P1-3). */
export function isSettingsDirty(current: ExtensionSettings, saved: ExtensionSettings): boolean {
  return (
    current.backendUrl.trim() !== saved.backendUrl ||
    current.model.trim() !== saved.model ||
    current.apiToken.trim() !== saved.apiToken ||
    current.dashboardContext.trim() !== saved.dashboardContext ||
    current.maxToolRounds.trim() !== saved.maxToolRounds
  );
}

export function SettingsPanel(props: {
  /** Sprache der Extension — persönlich, gilt sofort (siehe locale.ts). */
  locale: SupportedLocale;
  onLocaleChange: (locale: SupportedLocale) => void;
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
  const [maxToolRounds, setMaxToolRounds] = useState(props.settings.maxToolRounds);
  const [message, setMessage] = useState<string | null>(null);
  const [messageIsError, setMessageIsError] = useState(false);
  const [saving, setSaving] = useState(false);
  // Gezielte Verwerfen-/Weiterbearbeiten-Entscheidung statt stillschweigendem
  // Verwerfen beim Zurückgehen — nur bei tatsächlich ungespeicherten Eingaben
  // (UI-Review P1-3).
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const keepEditingRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (confirmingDiscard) keepEditingRef.current?.focus();
  }, [confirmingDiscard]);
  // Verbindung (Backend-URL/Token) ist selten nötig — eingeklappt, außer es ist
  // schon etwas gesetzt oder die URL ungültig. Nur initial, damit das Feld beim
  // Tippen nicht zuklappt.
  const [connectionInitiallyOpen] = useState(
    props.settings.backendUrl !== '' || props.settings.apiToken !== '' || !isAllowedBackendUrl(props.settings.backendUrl).ok,
  );

  const urlValidation = isAllowedBackendUrl(backendUrl);
  const maxToolRoundsValid = isValidMaxToolRounds(maxToolRounds);
  const isDirty = isSettingsDirty({ backendUrl, model, apiToken, dashboardContext, maxToolRounds }, props.settings);

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
    if (!maxToolRoundsValid) {
      setMessage(t('settings.maxToolRoundsInvalid', undefined, { min: MIN_TOOL_ROUNDS, max: MAX_TOOL_ROUNDS_SETTING }));
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
        maxToolRounds: maxToolRounds.trim(),
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
        // Kein role="alert" für eine Rückfrage mit Buttons; der Fokus springt
        // auf die sichere Aktion „Weiter bearbeiten" (UI-Review P1).
        <div class="settings-message settings-confirm" role="group" aria-labelledby="settings-discard-prompt">
          <p id="settings-discard-prompt">{t('settings.discardPrompt')}</p>
          <div class="settings-actions">
            <button ref={keepEditingRef} type="button" class="btn-primary" onClick={() => setConfirmingDiscard(false)}>
              {t('settings.keepEditingButton')}
            </button>
            <button type="button" class="btn-danger" onClick={props.onClose}>
              {t('settings.discardButton')}
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

      {/* PERSÖNLICH — speichert sofort (kein eigener Button). */}
      <section class="prefs-section">
        <h3>{t('settings.personalHeader')}</h3>
        <p class="field-hint">{t('settings.personalSaveHint')}</p>
        <label>
          {t('settings.language')}
          <select value={props.locale} onChange={(e) => props.onLocaleChange((e.target as HTMLSelectElement).value === 'de' ? 'de' : 'en')}>
            <option value="de" lang="de">Deutsch</option>
            <option value="en" lang="en">English</option>
          </select>
          <span class="field-hint">{t('settings.languageHint')}</span>
        </label>

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

        {/* OpenViz Watch (W6): an das angemeldete Konto gebunden (Bearer/Session),
            nicht an die Tableau-Anwenderkennung — deshalb unabhängig von userId. */}
        {props.features.watch && <WatchSettingsPanel backendUrl={props.backendUrl} apiToken={props.apiToken} />}

        {/* Ohne Anwenderkennung gibt es keine Personalisierung. Das passiert auf
            Tableau-Versionen vor 2023.2 (Extensions API 1.11), die das Manifest
            bewusst weiter zulässt — dann aber mit Ansage statt stillem Nichts:
            Sonst kauft jemand die Enterprise-Features und sieht nie, warum sie
            fehlen. */}
        {!props.userId && (props.features.memory || props.features.savedQueries) && (
          <p class="field-hint">{t('settings.personalHint')}</p>
        )}
      </section>

      {/* DIESES DASHBOARD — explizit über „Einstellungen speichern" (Leiste unten). */}
      <section class="prefs-section">
        <h3>{props.isAuthor ? t('settings.authorSectionTitle') : t('settings.dashboardSectionTitle')}</h3>
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
          {/* Viewer können nicht ins Workbook speichern — vorher sagen statt erst nach dem Klick. */}
          {!props.isAuthor && <span class="field-hint">{t('settings.viewerSessionHint')}</span>}
        </label>
        {props.isAuthor && (
          <>
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
            <label>
              {t('settings.maxToolRounds')}
              <input
                type="number"
                inputMode="numeric"
                min={MIN_TOOL_ROUNDS}
                max={MAX_TOOL_ROUNDS_SETTING}
                step={1}
                value={maxToolRounds}
                placeholder={t('settings.maxToolRoundsPlaceholder', undefined, {
                  ask: TOOL_ROUNDS_BY_MODE.ask,
                  investigate: TOOL_ROUNDS_BY_MODE.investigate,
                  estate: TOOL_ROUNDS_BY_MODE['investigate-estate'],
                })}
                aria-invalid={maxToolRoundsValid ? undefined : 'true'}
                aria-describedby={maxToolRoundsValid ? 'settings-max-rounds-hint' : 'settings-max-rounds-error'}
                onInput={(e) => setMaxToolRounds((e.target as HTMLInputElement).value)}
              />
              {maxToolRoundsValid ? (
                <span id="settings-max-rounds-hint" class="field-hint">
                  {t('settings.maxToolRoundsHint', undefined, { min: MIN_TOOL_ROUNDS, max: MAX_TOOL_ROUNDS_SETTING })}
                </span>
              ) : (
                <span id="settings-max-rounds-error" class="field-error">
                  {t('settings.maxToolRoundsInvalid', undefined, { min: MIN_TOOL_ROUNDS, max: MAX_TOOL_ROUNDS_SETTING })}
                </span>
              )}
            </label>
            <details class="settings-details" open={connectionInitiallyOpen}>
              <summary>{t('settings.connectionTitle')}</summary>
              <label>
                {t('settings.backendUrl')}
                <input
                  type="text"
                  value={backendUrl}
                  placeholder={t('settings.backendUrlPlaceholder')}
                  aria-invalid={urlValidation.ok ? undefined : 'true'}
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
            </details>
          </>
        )}
      </section>

      {props.isAuthor && (
        <section class="prefs-section">
          <h3>{t('settings.standardAnalysesTitle')}</h3>
          <p>{props.registrationMessage}</p>
          {props.registrationKey && <p class="field-hint">{t('settings.registrationKey', undefined, { key: props.registrationKey })}</p>}
          <button type="button" class="btn-danger" onClick={() => void props.onResetRegistration()}>{t('settings.resetRegistrationButton')}</button>
          <p class="field-hint">{t('settings.resetRegistrationHint')}</p>
        </section>
      )}

      {/* Speichern-Leiste bleibt am unteren Rand sichtbar (UI-Review P1). */}
      <div class="settings-savebar">
        {message && (
          <div class="settings-message" role={messageIsError ? 'alert' : 'status'} aria-live={messageIsError ? 'assertive' : 'polite'}>
            {message}
          </div>
        )}
        <div class="settings-actions">
          <button type="button" class="btn-primary" onClick={() => void save()} disabled={saving}>
            {saving ? t('settings.saving') : t('settings.saveButton')}
          </button>
          <span class="field-hint">{isDirty ? t('settings.unsavedChanges') : t('settings.explicitSaveHint')}</span>
        </div>
      </div>
    </div>
  );
}
