import { MAX_AUTHOR_CONTEXT_CHARS, t } from '@openvizpilot/shared';
import { getTableau } from './tableau/api';

/**
 * Persistente Extension-Einstellungen über den Tableau-Settings-Namespace
 * (im Workbook gespeichert, für alle Workbook-Nutzer sichtbar und vom
 * Workbook-Autor änderbar).
 *
 * VERTRAUENSMODELL: Der Workbook-Autor kontrolliert die Backend-URL — an
 * diese URL gehen alle Fragen und Dashboard-Daten des jeweiligen Viewers.
 * Deshalb wird die URL validiert (nur HTTPS bzw. localhost) und sollte in
 * Produktion leer bleiben (= gleicher Origin wie die Extension, der von der
 * Server-Safelist des Tableau-Admins abgedeckt ist). Details:
 * docs/admin-deployment.md.
 */
export interface ExtensionSettings {
  /** '' = gleicher Origin wie die Extension (Dev-Proxy / Prod-Serving). */
  backendUrl: string;
  /** '' = Default-Modell der Middleware. */
  model: string;
  /** Optionaler Auth-Token der Middleware (OVP_API_AUTH_TOKEN). */
  apiToken: string;
  /**
   * Freitext-Glossar/KPI-Definitionen des Workbook-Autors, workbook-weit für
   * alle Viewer sichtbar — unkritisch, da reine DATEN (siehe system-prompt.ts,
   * niemals als Anweisung interpretiert).
   */
  dashboardContext: string;
  /** Max. Tool-Runden je Antwort (Ganzzahl 1–50 als Text); '' = Standardbudget je Modus. */
  maxToolRounds: string;
}

const KEY_BACKEND_URL = 'tableauChat.backendUrl';
const KEY_MODEL = 'tableauChat.model';
const KEY_API_TOKEN = 'tableauChat.apiToken';
const KEY_DASHBOARD_CONTEXT = 'tableauChat.dashboardContext';
const KEY_MAX_TOOL_ROUNDS = 'tableauChat.maxToolRounds';

export const MIN_TOOL_ROUNDS = 1;
export const MAX_TOOL_ROUNDS_SETTING = 50;

/** Leer (= Standardbudget) oder eine Ganzzahl im erlaubten Bereich. */
export function isValidMaxToolRounds(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed === '') return true;
  if (!/^\d+$/.test(trimmed)) return false;
  const n = Number(trimmed);
  return n >= MIN_TOOL_ROUNDS && n <= MAX_TOOL_ROUNDS_SETTING;
}

/** Parst die Einstellung; ungültig/leer → undefined (Standardbudget). */
export function parseMaxToolRounds(value: string): number | undefined {
  const n = Number.parseInt(value.trim(), 10);
  return Number.isFinite(n) && n >= MIN_TOOL_ROUNDS ? Math.min(n, MAX_TOOL_ROUNDS_SETTING) : undefined;
}

export function isAllowedBackendUrl(url: string): { ok: boolean; reason?: string } {
  const trimmed = url.trim();
  if (trimmed === '') return { ok: true };
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, reason: t('settings.urlInvalidFormat') };
  }
  if (parsed.protocol === 'https:') return { ok: true };
  if (parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname)) {
    return { ok: true };
  }
  return { ok: false, reason: t('settings.urlProtocolNotAllowed') };
}

export function loadSettings(): ExtensionSettings {
  try {
    const s = getTableau().extensions.settings;
    return {
      backendUrl: s.get(KEY_BACKEND_URL) ?? '',
      model: s.get(KEY_MODEL) ?? '',
      apiToken: s.get(KEY_API_TOKEN) ?? '',
      dashboardContext: s.get(KEY_DASHBOARD_CONTEXT) ?? '',
      maxToolRounds: s.get(KEY_MAX_TOOL_ROUNDS) ?? '',
    };
  } catch {
    return { backendUrl: '', model: '', apiToken: '', dashboardContext: '', maxToolRounds: '' };
  }
}

export async function saveSettings(
  settings: ExtensionSettings,
): Promise<{ persisted: boolean; message?: string }> {
  const validation = isAllowedBackendUrl(settings.backendUrl);
  if (!validation.ok) {
    return { persisted: false, message: t('settings.urlNotSaved', undefined, { reason: validation.reason ?? '' }) };
  }
  const s = getTableau().extensions.settings;
  s.set(KEY_BACKEND_URL, settings.backendUrl.trim());
  s.set(KEY_MODEL, settings.model.trim());
  s.set(KEY_API_TOKEN, settings.apiToken.trim());
  s.set(KEY_DASHBOARD_CONTEXT, settings.dashboardContext.trim().slice(0, MAX_AUTHOR_CONTEXT_CHARS));
  s.set(KEY_MAX_TOOL_ROUNDS, String(parseMaxToolRounds(settings.maxToolRounds) ?? ''));
  try {
    // saveAsync funktioniert nur im Authoring-Modus.
    await s.saveAsync();
    return { persisted: true };
  } catch {
    return {
      persisted: false,
      message: t('settings.sessionOnly'),
    };
  }
}
