import { DASHBOARD_KEY_HEADER, USER_ID_HEADER } from '@openvizpilot/shared';
import { dashboardPrefsSchema, type DashboardPrefs } from '../../server/src/personalization-schema';

/**
 * Client für die Per-Dashboard-Präferenzen (Antwortfokus, Standardfragen)
 * unter /api/memory/prefs — gleiches Header-Vertrauensmodell wie die übrigen
 * Memory-Endpoints, siehe ee/server/src/personalization.ts. Ohne
 * Enterprise-Lizenz ruft die Extension loadPrefs gar nicht erst auf (siehe
 * features.savedQueries-Gate in App.tsx).
 */

function prefsHeaders(userId: string, dashboardKey: string, apiToken?: string): Record<string, string> {
  return {
    [USER_ID_HEADER]: userId,
    [DASHBOARD_KEY_HEADER]: dashboardKey,
    ...(apiToken ? { authorization: `Bearer ${apiToken}` } : {}),
  };
}

/**
 * Lädt die gespeicherten Präferenzen für (userId, dashboardKey).
 * Liefert null NUR, wenn der Server bestätigt, dass nichts gespeichert ist
 * (`{ prefs: null }`, HTTP 200). Bei Netzwerk-/HTTP-/Formatfehlern wird
 * geworfen — der Aufrufer darf das nicht mit "leer" verwechseln, sonst wirkt
 * ein Ladefehler wie ein Verlust gespeicherter Fragen (siehe UI-Review P1-4).
 */
export async function loadPrefs(
  baseUrl: string,
  apiToken: string | undefined,
  userId: string,
  dashboardKey: string,
): Promise<DashboardPrefs | null> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl}/api/memory/prefs`, {
      headers: prefsHeaders(userId, dashboardKey, apiToken),
    });
  } catch {
    throw new Error('Präferenzen konnten nicht geladen werden — Server nicht erreichbar.');
  }
  if (!res.ok) {
    throw new Error(`Präferenzen konnten nicht geladen werden (HTTP ${res.status}).`);
  }
  let data: { prefs: unknown };
  try {
    data = (await res.json()) as { prefs: unknown };
  } catch {
    throw new Error('Präferenzen konnten nicht geladen werden — ungültige Antwort.');
  }
  if (data.prefs === null || data.prefs === undefined) return null;
  const parsed = dashboardPrefsSchema.safeParse(data.prefs);
  if (!parsed.success) {
    throw new Error('Präferenzen konnten nicht geladen werden — unerwartetes Format.');
  }
  return parsed.data;
}

/** Speichert die Präferenzen für (userId, dashboardKey); wirft bei Fehler. */
export async function savePrefs(
  baseUrl: string,
  apiToken: string | undefined,
  userId: string,
  dashboardKey: string,
  prefs: DashboardPrefs,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl}/api/memory/prefs`, {
      method: 'PUT',
      headers: { ...prefsHeaders(userId, dashboardKey, apiToken), 'content-type': 'application/json' },
      body: JSON.stringify(prefs),
    });
  } catch {
    throw new Error('Präferenzen konnten nicht gespeichert werden — Server nicht erreichbar.');
  }
  if (!res.ok) {
    throw new Error(`Präferenzen konnten nicht gespeichert werden (HTTP ${res.status}).`);
  }
}
