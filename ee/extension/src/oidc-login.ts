import type { AuthConfigResponse, AuthSession } from '@openvizpilot/shared';

/**
 * OIDC-Login der Extension (Enterprise): Authorization Code + PKCE in einem
 * Popup. Die Extension läuft im Tableau-iframe und darf nicht navigieren —
 * das Popup lädt den IdP, dessen Redirect landet auf /auth/callback der
 * Middleware, die code/state per postMessage zurückreicht. Den Code tauscht
 * die MIDDLEWARE (BFF) gegen das ID-Token; die Extension hält nur das
 * verifizierte ID-Token für die Dauer der Sitzung (sessionStorage).
 *
 * Sicherheitsinvarianten:
 * - state wird gegen den gespeicherten Wert geprüft (CSRF).
 * - Nachrichten werden nur vom Origin der Callback-URL akzeptiert.
 * - Der PKCE-Verifier verlässt den Browser nur zum eigenen Middleware-BFF.
 */

export type AuthConfig = AuthConfigResponse;
export type OidcSession = AuthSession;

const MESSAGE_TYPE = 'openvizpilot-oidc';
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;
/** Ausstehender Login für den Same-Window-Fallback (Popup blockiert). */
const PENDING_KEY = 'openvizpilot.oidcPending';
/** Fragment-Marker, mit dem /auth/callback ohne Opener zur Extension zurückkehrt. */
export const REDIRECT_FRAGMENT_KEY = 'openvizpilot-oidc';

interface PendingLogin {
  state: string;
  verifier: string;
  redirectUri: string;
}

function savePending(p: PendingLogin): void {
  try {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify(p));
  } catch {
    /* ohne sessionStorage kein Fallback */
  }
}

function takePending(): PendingLogin | null {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    sessionStorage.removeItem(PENDING_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PendingLogin>;
    return parsed.state && parsed.verifier && parsed.redirectUri ? (parsed as PendingLogin) : null;
  } catch {
    return null;
  }
}

/** Liest code/state/error aus dem Rückkehr-Fragment (#openvizpilot-oidc&code=…&state=…). */
export function parseRedirectFragment(hash: string): { code: string | null; state: string | null; error: string | null } | null {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!raw.startsWith(REDIRECT_FRAGMENT_KEY)) return null;
  const params = new URLSearchParams(raw.slice(REDIRECT_FRAGMENT_KEY.length + 1));
  return { code: params.get('code'), state: params.get('state'), error: params.get('error') };
}

function randomString(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return base64url(buf);
}

function base64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

export function buildAuthorizationUrl(config: AuthConfig, params: { state: string; codeChallenge: string }): string {
  if (!config.authorizationEndpoint || !config.clientId || !config.redirectUri) {
    throw new Error('OIDC-Konfiguration unvollständig');
  }
  const url = new URL(config.authorizationEndpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('scope', config.scopes ?? 'openid profile email');
  url.searchParams.set('state', params.state);
  url.searchParams.set('code_challenge', params.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  if (config.provider === 'entra') url.searchParams.set('prompt', 'select_account');
  return url.toString();
}

export interface LoginDeps {
  baseUrl: string;
  config: AuthConfig;
  /** Injizierbar für Tests. */
  openPopup?: (url: string) => Window | null;
  fetchImpl?: typeof fetch;
}

/**
 * Startet den Popup-Login und liefert die verifizierte Session. Muss aus einer
 * User-Geste (Klick) heraus aufgerufen werden — sonst blockt der Browser das Popup.
 */
export async function loginWithPopup(deps: LoginDeps): Promise<OidcSession> {
  const { baseUrl, config } = deps;
  const fetchImpl = deps.fetchImpl ?? fetch;
  if (!config.redirectUri) throw new Error('OIDC-Konfiguration unvollständig');
  const verifier = randomString(48);
  const state = randomString(24);
  const url = buildAuthorizationUrl(config, { state, codeChallenge: await pkceChallenge(verifier) });
  const expectedOrigin = new URL(config.redirectUri).origin;

  // Für den Fall, dass das Popup blockiert wird (oder die Umgebung window.open
  // im selben Fenster öffnet): Zustand merken und per Redirect anmelden —
  // /auth/callback kehrt dann ohne Opener per Fragment zur Extension zurück.
  savePending({ state, verifier, redirectUri: config.redirectUri });
  const open = deps.openPopup ?? ((u: string) => window.open(u, 'openvizpilot-login', 'popup,width=520,height=680'));
  const popup = open(url);
  if (!popup) {
    window.location.assign(url);
    return new Promise<OidcSession>(() => undefined); // Seite wird verlassen
  }

  const code = await new Promise<string>((resolve, reject) => {
    const cleanup = () => {
      window.removeEventListener('message', onMessage);
      clearInterval(closedPoll);
      clearTimeout(timeout);
    };
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== expectedOrigin) return;
      const data = event.data as { type?: string; code?: string | null; state?: string | null; error?: string | null };
      if (!data || data.type !== MESSAGE_TYPE) return;
      if (data.state !== state) return; // fremde/alte Antwort ignorieren
      cleanup();
      if (data.error || !data.code) {
        reject(new Error(data.error === 'access_denied' ? 'Anmeldung abgebrochen.' : `Anmeldung fehlgeschlagen (${data.error ?? 'kein Code'}).`));
        return;
      }
      resolve(data.code);
    };
    window.addEventListener('message', onMessage);
    const closedPoll = setInterval(() => {
      if (popup.closed) {
        cleanup();
        reject(new Error('Das Anmeldefenster wurde geschlossen.'));
      }
    }, 500);
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Zeitüberschreitung bei der Anmeldung.'));
    }, LOGIN_TIMEOUT_MS);
  });

  takePending(); // Popup-Weg genommen — Fallback-Zustand verwerfen
  return exchange(fetchImpl, baseUrl, { code, codeVerifier: verifier, redirectUri: config.redirectUri });
}

async function exchange(
  fetchImpl: typeof fetch,
  baseUrl: string,
  body: { code: string; codeVerifier: string; redirectUri: string },
): Promise<OidcSession> {
  const res = await fetchImpl(`${baseUrl}/api/auth/exchange`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { token?: string; expiresAt?: number; user?: OidcSession['user']; error?: string };
  if (!res.ok || !data.token || typeof data.expiresAt !== 'number') {
    throw new Error(data.error ?? `Anmeldung fehlgeschlagen (HTTP ${res.status}).`);
  }
  return { token: data.token, expiresAt: data.expiresAt, user: data.user ?? {} };
}

/**
 * Schließt einen Same-Window-Login ab, wenn die Seite mit dem Rückkehr-
 * Fragment geladen wurde. null, wenn kein Login aussteht. Wirft bei
 * abgelehnter/abgebrochener Anmeldung — der Aufrufer zeigt die Meldung.
 */
export async function completeRedirectLogin(deps: { baseUrl: string; fetchImpl?: typeof fetch }): Promise<OidcSession | null> {
  const result = parseRedirectFragment(window.location.hash);
  if (!result) return null;
  try {
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
  } catch {
    /* ignorieren */
  }
  const pending = takePending();
  if (!pending || result.state !== pending.state) throw new Error('Anmeldung konnte nicht zugeordnet werden — bitte erneut anmelden.');
  if (result.error || !result.code) {
    throw new Error(result.error === 'access_denied' ? 'Anmeldung abgebrochen.' : `Anmeldung fehlgeschlagen (${result.error ?? 'kein Code'}).`);
  }
  return exchange(deps.fetchImpl ?? fetch, deps.baseUrl, { code: result.code, codeVerifier: pending.verifier, redirectUri: pending.redirectUri });
}

/** Erkennt eine abgelaufene/ungültige Anmeldung anhand der Middleware-Antwort. */
export function isAuthRequiredError(message: string): boolean {
  return /HTTP 401/.test(message);
}

