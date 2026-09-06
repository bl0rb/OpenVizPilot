import { MAX_AUTHOR_CONTEXT_CHARS, type ModelOption } from '@openvizpilot/shared';
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
      <section class="prefs-section">
        <h3>Standardanalysen pro Dashboard</h3>
        <p>{props.registrationMessage}</p>
        {props.registrationKey && <p class="field-hint">Zuordnung: {props.registrationKey}</p>}
        <button type="button" onClick={() => void props.onResetRegistration()}>Neue Zuordnung für eine Dashboard-Kopie</button>
        <p class="field-hint">Kopierte Workbooks teilen zunächst dieselben Standardanalysen. Für getrennte Analysen im Bearbeitungsmodus eine neue Zuordnung erstellen und das Workbook speichern.</p>
      </section>
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

      {/* Ohne Anwenderkennung gibt es keine Personalisierung. Das passiert auf
          Tableau-Versionen vor 2023.2 (Extensions API 1.11), die das Manifest
          bewusst weiter zulässt — dann aber mit Ansage statt stillem Nichts:
          Sonst kauft jemand die Enterprise-Features und sieht nie, warum sie
          fehlen. */}
      {!props.userId && (props.features.memory || props.features.savedQueries) && (
        <section class="prefs-section">
          <h3>Persönliche Einstellungen</h3>
          <p class="field-hint">
            Diese Tableau-Version liefert keine Anwenderkennung — persönliche Fakten und gespeicherte
            Abfragen sind deshalb nicht verfügbar. Sie brauchen Tableau 2023.2 oder neuer
            (Extensions API 1.11).
          </p>
        </section>
      )}

    </div>
  );
}
