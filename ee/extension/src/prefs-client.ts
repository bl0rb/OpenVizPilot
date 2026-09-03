import { DASHBOARD_KEY_HEADER, USER_ID_HEADER } from '@openvizpilot/shared';
import { dashboardPrefsSchema, type DashboardPrefs } from '../../server/src/personalization-schema';

/**
 * Client für die Per-Dashboard-Präferenzen (Antwortfokus, Standardfragen)
 * unter /api/memory/prefs — gleiches Header-Vertrauensmodell wie die übrigen
 * Memory-Endpoints, siehe ee/server/src/personalization.ts. Ohne
 * Enterprise-Lizenz antwortet der Endpunkt mit 402; loadPrefs liefert dann
 * null, und die Extension blendet die Bereiche aus.
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
 * Liefert null, wenn nichts gespeichert ist ODER die Anfrage fehlschlägt
 * (Memory evtl. deaktiviert) — der Aufrufer unterscheidet das nicht.
 */
export async function loadPrefs(
  baseUrl: string,
  apiToken: string | undefined,
  userId: string,
  dashboardKey: string,
): Promise<DashboardPrefs | null> {
  try {
    const res = await fetch(`${baseUrl}/api/memory/prefs`, {
      headers: prefsHeaders(userId, dashboardKey, apiToken),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { prefs: unknown };
    const parsed = dashboardPrefsSchema.safeParse(data.prefs);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
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
