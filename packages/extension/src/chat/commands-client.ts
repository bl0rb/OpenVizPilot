import { DEFAULT_SLASH_COMMANDS, slashCommandListSchema, type SlashCommand, type UsageMetric } from '@openvizpilot/shared';

/**
 * Client für die zentral (Admin-UI) verwaltbaren Slash-Befehle sowie für die
 * anonyme Nutzungsstatistik — Gegenstück zu server/routes/commands.ts und
 * server/routes/stats.ts.
 *
 * VERTRAUENSMODELL: Beide Endpunkte laufen unter dem normalen API_AUTH_TOKEN-
 * Regime wie /api/chat (gleicher Header). /api/stats bekommt bewusst NIE eine
 * User-ID oder Frage-/Antwort-Inhalte — nur Metrik+Key, siehe sendUsageEvents.
 */

function authHeaders(apiToken?: string): Record<string, string> {
  return apiToken ? { authorization: `Bearer ${apiToken}` } : {};
}

/**
 * Lädt die serverseitig konfigurierten Slash-Befehle. Bei jedem Fehler (Netz,
 * HTTP-Status, ungültige Antwort) fällt der Aufruf still auf die eingebauten
 * Defaults zurück — die Extension bleibt so ohne erreichbaren Server bzw.
 * ohne Admin-Konfiguration voll funktionsfähig.
 */
export interface LoadedCommands {
  commands: SlashCommand[];
  /** Starter-Fragen aus dem Dashboard-Playbook des Admins (leer ohne Playbook). */
  starters: string[];
}

export async function loadSlashCommands(
  baseUrl: string,
  apiToken?: string,
  dashboardKey?: string,
): Promise<LoadedCommands> {
  const fallback: LoadedCommands = { commands: DEFAULT_SLASH_COMMANDS, starters: [] };
  try {
    const query = dashboardKey ? `?dashboardKey=${encodeURIComponent(dashboardKey)}` : '';
    const res = await fetch(`${baseUrl}/api/commands${query}`, { headers: authHeaders(apiToken) });
    if (!res.ok) return fallback;
    const data = (await res.json()) as { commands: unknown; starters?: unknown };
    const parsed = slashCommandListSchema.safeParse(data.commands);
    const starters = Array.isArray(data.starters)
      ? data.starters.filter((s): s is string => typeof s === 'string' && s.trim().length > 0).slice(0, 5)
      : [];
    return { commands: parsed.success ? parsed.data : DEFAULT_SLASH_COMMANDS, starters };
  } catch {
    return fallback;
  }
}

/**
 * Meldet anonyme Nutzungs-Events (fire-and-forget — Fehler werden geschluckt,
 * eine fehlgeschlagene Statistik darf den Chat nie stören). BEWUSST ohne
 * User-Header und ohne Frage-/Antwort-Inhalte, siehe Datenschutz-Notiz oben.
 */
export function sendUsageEvents(
  baseUrl: string,
  apiToken: string | undefined,
  events: Array<{ metric: UsageMetric; key: string }>,
): void {
  if (events.length === 0) return;
  void fetch(`${baseUrl}/api/stats`, {
    method: 'POST',
    headers: { ...authHeaders(apiToken), 'content-type': 'application/json' },
    body: JSON.stringify({ events }),
  }).catch(() => undefined);
}
