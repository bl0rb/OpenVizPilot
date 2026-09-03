import type { AuthConfigResponse, AuthSession } from '@openvizpilot/shared';

/**
 * Anmeldung der Extension an der Middleware (Open Core: lokale Benutzer;
 * Enterprise: OIDC-Popup aus ee/). Die Sitzung (Bearer-Token) liegt nur im
 * sessionStorage des Tableau-iframes — nie im Workbook.
 */

const SESSION_KEY = 'openvizpilot.session';

export async function fetchAuthConfig(baseUrl: string): Promise<AuthConfigResponse> {
  try {
    const res = await fetch(`${baseUrl}/api/auth/config`);
    const data = (await res.json()) as AuthConfigResponse;
    if (data && ['none', 'token', 'local', 'oidc'].includes(data.mode)) return data;
    return { mode: 'none' };
  } catch {
    // Middleware nicht erreichbar: kein Gate — der Chat meldet den Fehler selbst.
    return { mode: 'none' };
  }
}

export function loadSession(): AuthSession | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AuthSession;
    if (!parsed.token || typeof parsed.expiresAt !== 'number') return null;
    if (parsed.expiresAt <= Date.now()) {
      sessionStorage.removeItem(SESSION_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function saveSession(session: AuthSession): void {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    /* privater Modus o. ä. — Session gilt dann nur im Speicher */
  }
}

export function clearSession(): void {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignorieren */
  }
}

/** Open-Core-Login mit Benutzername/Passwort (Konten aus der Admin-UI). */
export async function loginLocal(baseUrl: string, username: string, password: string): Promise<AuthSession> {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const body = (await res.json().catch(() => ({}))) as Partial<AuthSession> & { error?: string };
  if (!res.ok || !body.token || typeof body.expiresAt !== 'number') {
    throw new Error(body.error ?? `Anmeldung fehlgeschlagen (HTTP ${res.status}).`);
  }
  return { token: body.token, expiresAt: body.expiresAt, user: body.user ?? {} };
}

/**
 * Prüft beim Start, ob eine gespeicherte Sitzung serverseitig noch gilt
 * (Moduswechsel in der Admin-UI, Ablauf, Sperre). Nur ein klares 401 gilt
 * als "ungültig" — Netzwerkfehler lassen die Sitzung bestehen.
 */
export async function validateSession(baseUrl: string, token: string): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/api/session`, { headers: { authorization: `Bearer ${token}` } });
    return res.status !== 401;
  } catch {
    return true;
  }
}

/** Meldet die Sitzung serverseitig ab (fire-and-forget). */
export function logoutRemote(baseUrl: string, token: string): void {
  void fetch(`${baseUrl}/api/auth/logout`, { method: 'POST', headers: { authorization: `Bearer ${token}` } }).catch(
    () => undefined,
  );
}

/** Erkennt eine abgelaufene/ungültige Anmeldung anhand der Middleware-Antwort. */
export function isAuthRequiredError(message: string): boolean {
  return /HTTP 401/.test(message);
}
