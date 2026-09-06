import { useEffect, useState } from 'preact/hooks';
import { t, USER_ID_HEADER } from '@openvizpilot/shared';

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
        if (!cancelled) setStatus(t('memory.fetchFailed'));
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
      setStatus(t('memory.deleted'));
    } catch {
      setStatus(t('memory.deleteFailed'));
    }
  };

  // Nicht lizenziert und nichts gespeichert: Es gibt nichts zu zeigen.
  if (!props.licensed && (facts === null || facts.length === 0)) return null;

  return (
    <div class="memory-section">
      <h3>{t('memory.title')}</h3>
      <p class="memory-hint">
        {props.licensed ? t('memory.licensedHint') : t('memory.unlicensedHint')}
      </p>
      {facts === null ? (
        <p class="memory-hint">{status ?? t('memory.loading')}</p>
      ) : facts.length === 0 ? (
        <p class="memory-hint">{t('memory.empty')}</p>
      ) : (
        <ul class="memory-list">
          {facts.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      )}
      {facts !== null && facts.length > 0 && (
        <button type="button" class="btn-danger" onClick={() => void deleteAll()}>
          {t('memory.deleteAll')}
        </button>
      )}
      {facts !== null && status && <p class="memory-hint">{status}</p>}
    </div>
  );
}
