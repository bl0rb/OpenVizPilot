import { MAX_AUTHOR_CONTEXT_CHARS, type ModelOption } from '@openvizpilot/shared';
import { MemoryFactsPanel, SavedQueriesPanel, type DashboardPrefs } from '@openvizpilot/ee/extension';
import { useState } from 'preact/hooks';
import { isAllowedBackendUrl, type ExtensionSettings } from '../settings';
import type { EeFeatures } from '../chat/features-client';

export function SettingsPanel(props: {
  settings: ExtensionSettings;
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
      setMessage(urlValidation.reason ?? 'Ungültige Backend-URL.');
      return;
    }
    const result = await props.onSave({
      backendUrl: backendUrl.trim(),
      model: model.trim(),
      apiToken: apiToken.trim(),
      dashboardContext: dashboardContext.trim(),
    });
    setMessage(result ?? 'Gespeichert.');
  };

  return (
    <div class="settings-panel">
      <h2>Einstellungen</h2>
      <label>
        Backend-URL
        <input
          type="text"
          value={backendUrl}
          placeholder="(leer = gleicher Origin, empfohlen)"
          onInput={(e) => setBackendUrl((e.target as HTMLInputElement).value)}
        />
        {!urlValidation.ok && <span class="field-error">{urlValidation.reason}</span>}
      </label>
      <label>
        API-Token (optional)
        <input
          type="password"
          value={apiToken}
          placeholder="(nur wenn die Middleware einen Token verlangt)"
          onInput={(e) => setApiToken((e.target as HTMLInputElement).value)}
        />
      </label>
      <label>
        Modell
        <select value={model} onInput={(e) => setModel((e.target as HTMLSelectElement).value)}>
          <option value="">
            Standard (
            {props.models.find((m) => m.id === props.defaultModel)?.label ||
              props.defaultModel ||
              'Server-Default'}
            )
          </option>
          {props.models.map((m) => (
            <option key={m.id} value={m.id} title={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Dashboard-Kontext / Glossar (für alle Nutzer dieses Workbooks)
        <textarea
          value={dashboardContext}
          maxLength={MAX_AUTHOR_CONTEXT_CHARS}
          rows={5}
          placeholder="z. B. KPI-Definitionen, Abkürzungen, fachliche Hinweise…"
          onInput={(e) => setDashboardContext((e.target as HTMLTextAreaElement).value)}
        />
        <span class="field-hint">
          Personalisiert Antworten inhaltlich (Begriffe, Schwerpunkte) — ändert keine Sicherheitsregeln.
          Speichern ins Workbook ist nur im Bearbeitungsmodus möglich.
        </span>
      </label>
      {message && <div class="settings-message">{message}</div>}
      <div class="settings-actions">
        <button type="button" onClick={() => void save()}>
          Speichern
        </button>
        <button type="button" class="btn-secondary" onClick={props.onClose}>
          Schließen
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

    </div>
  );
}
