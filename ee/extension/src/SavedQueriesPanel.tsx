import { FOCUS_PRESETS, MAX_STANDARD_QUESTIONS, type DashboardPrefs } from '../../server/src/personalization-schema';
import { useState } from 'preact/hooks';

/**
 * Eigene Abfragen speichern (Enterprise): Antwortfokus und die Standardfragen,
 * die der Anwender sich pro Dashboard merkt. Ohne Lizenz blendet der Kern
 * diesen Bereich aus und speichert nichts.
 */
export function SavedQueriesPanel(props: {
  /** Per-Dashboard-Präferenzen — siehe PrefsState in der Extension. */
  prefs: DashboardPrefs | null | 'loading' | 'unavailable';
  onSavePrefs: (prefs: DashboardPrefs) => Promise<string | null>;
}) {
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Aktuelle Präferenzen normalisiert ('loading'/'unavailable'/null → leerer
  // Datensatz), damit Select und Liste immer einen konkreten Stand zeigen.
  const current: DashboardPrefs =
    typeof props.prefs === 'object' && props.prefs !== null ? props.prefs : { focus: '', questions: [] };

  const save = async (next: DashboardPrefs, okText: string) => {
    setBusy(true);
    const result = await props.onSavePrefs(next);
    setMessage(result ?? okText);
    setBusy(false);
  };

  return (
    <div class="prefs-section">
      <h3>Dieses Dashboard</h3>
      <label>
        Antwortfokus
        <select
          value={current.focus}
          disabled={props.prefs === 'loading' || busy}
          onInput={(e) => void save({ ...current, focus: (e.target as HTMLSelectElement).value }, 'Antwortfokus gespeichert.')}
        >
          <option value="">Kein Fokus</option>
          {FOCUS_PRESETS.map((preset) => (
            <option key={preset} value={preset}>
              {preset}
            </option>
          ))}
        </select>
      </label>
      <p class="memory-hint">
        Gespeicherte Standardfragen ({current.questions.length}/{MAX_STANDARD_QUESTIONS})
      </p>
      {current.questions.length === 0 ? (
        <p class="memory-hint">Noch keine Standardfragen gespeichert.</p>
      ) : (
        <ul class="prefs-question-list">
          {current.questions.map((q) => (
            <li key={q}>
              <span>{q}</span>
              <button
                type="button"
                class="btn-icon"
                title="Standardfrage löschen"
                disabled={busy}
                onClick={() => void save({ ...current, questions: current.questions.filter((x) => x !== q) }, 'Standardfrage gelöscht.')}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      {message && <p class="memory-hint">{message}</p>}
    </div>
  );
}
