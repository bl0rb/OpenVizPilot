import { useEffect, useState } from 'preact/hooks';
import { USER_ID_HEADER } from '@openvizpilot/shared';

/**
 * User-Memory in den Einstellungen (Enterprise): zeigt, was die Middleware
 * über den Anwender gespeichert hat, und löscht es auf Wunsch komplett
 * (DSGVO Art. 15/17).
 *
 * Ohne Lizenz kommen keine neuen Fakten mehr dazu, aber bereits gespeicherte
 * bleiben sichtbar und löschbar — sonst nähme eine ausgelaufene Lizenz dem
 * Anwender sein Auskunfts- und Löschrecht. Ist nichts gespeichert und die
 * Funktion nicht lizenziert, verschwindet der Bereich ganz.
 */
export function MemoryFactsPanel(props: { backendUrl: string; apiToken: string; userId: string; licensed: boolean }) {
  const [facts, setFacts] = useState<string[] | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const headers = (): Record<string, string> => ({
    [USER_ID_HEADER]: props.userId,
    ...(props.apiToken ? { authorization: `Bearer ${props.apiToken}` } : {}),
  });

  useEffect(() => {
    if (!props.userId) return;
    let cancelled = false;
    fetch(`${props.backendUrl}/api/memory`, { headers: headers() })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data: { facts: string[] }) => {
        if (!cancelled) setFacts(data.facts);
      })
      .catch(() => {
        if (!cancelled) setStatus('Gespeicherte Infos nicht abrufbar (Memory evtl. deaktiviert).');
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.backendUrl, props.userId, props.apiToken]);

  const deleteAll = async () => {
    try {
      const res = await fetch(`${props.backendUrl}/api/memory`, { method: 'DELETE', headers: headers() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setFacts([]);
      setStatus('Alle gespeicherten Infos wurden gelöscht.');
    } catch {
      setStatus('Löschen fehlgeschlagen — bitte später erneut versuchen.');
    }
  };

  // Nicht lizenziert und nichts gespeichert: Es gibt nichts zu zeigen.
  if (!props.licensed && (facts === null || facts.length === 0)) return null;

  return (
    <div class="memory-section">
      <h3>Gespeicherte Infos über mich</h3>
      <p class="memory-hint">
        {props.licensed
          ? 'Der Assistent merkt sich persönliche Angaben (z. B. Name, bevorzugte Sichten), um Dashboard-Antworten zu personalisieren — nie Dashboard-Daten.'
          : 'Diese Infos stammen aus einer Zeit mit Enterprise-Lizenz. Es kommen keine neuen hinzu; löschen kannst du sie weiterhin jederzeit.'}
      </p>
      {facts === null ? (
        <p class="memory-hint">{status ?? 'Lade…'}</p>
      ) : facts.length === 0 ? (
        <p class="memory-hint">Noch nichts gespeichert.</p>
      ) : (
        <ul class="memory-list">
          {facts.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      )}
      {facts !== null && facts.length > 0 && (
        <button type="button" class="btn-danger" onClick={() => void deleteAll()}>
          Alle gespeicherten Infos löschen
        </button>
      )}
      {facts !== null && status && <p class="memory-hint">{status}</p>}
    </div>
  );
}
