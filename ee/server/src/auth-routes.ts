import type { AuthConfigResponse } from '@openvizpilot/shared';
import { Hono, type MiddlewareHandler } from 'hono';
import { z } from 'zod';
import { OidcClient, OidcError, PROVIDER_LABELS } from './oidc';

/**
 * OIDC-Bausteine für die Auth-Routen der Middleware (Enterprise):
 *
 * - oidcConfigResponse()   — Login-Parameter für GET /api/auth/config
 * - handleOidcExchange()   — Code + PKCE-Verifier → verifiziertes ID-Token (BFF)
 * - AUTH_CALLBACK_HTML     — Redirect-Ziel des IdP (/auth/callback): reicht
 *                            code/state per postMessage an das Popup-Opener
 * - requireOidcUser()      — Bearer-ID-Token verifizieren, `authUser` = sub
 *
 * Die Routen selbst werden im Kern (server/routes/auth.ts) zusammengesetzt,
 * weil der Modus zur Laufzeit aus der Admin-UI kommt.
 */

export interface AuthVariables {
  Variables: { authUser?: string };
}

export type AuthLog = (level: 'info' | 'warn' | 'error', msg: string, data?: Record<string, unknown>) => void;

const exchangeSchema = z.object({
  code: z.string().min(1).max(4096),
  codeVerifier: z.string().min(43).max(128),
  redirectUri: z.string().url(),
});

export function redirectUriFor(publicUrl: string | null, requestUrl: string): string {
  const origin = publicUrl ? publicUrl.replace(/\/$/, '') : new URL(requestUrl).origin;
  return `${origin}/auth/callback`;
}

export async function oidcConfigResponse(
  oidc: OidcClient,
  publicUrl: string | null,
  requestUrl: string,
  log: AuthLog,
): Promise<{ status: 200 | 503; body: AuthConfigResponse }> {
  try {
    const discovery = await oidc.discovery();
    return {
      status: 200,
      body: {
        mode: 'oidc',
        provider: oidc.settings.provider,
        providerLabel: PROVIDER_LABELS[oidc.settings.provider],
        authorizationEndpoint: discovery.authorization_endpoint,
        clientId: oidc.settings.clientId,
        scopes: oidc.settings.scopes,
        redirectUri: redirectUriFor(publicUrl, requestUrl),
      },
    };
  } catch (err) {
    log('error', 'oidc discovery failed', { name: err instanceof Error ? err.name : 'unknown' });
    return { status: 503, body: { mode: 'oidc', error: 'Identity-Provider nicht erreichbar' } };
  }
}

export async function handleOidcExchange(
  oidc: OidcClient,
  rawBody: unknown,
  publicUrl: string | null,
  requestUrl: string,
  log: AuthLog,
): Promise<{ status: 200 | 400 | 401 | 503; body: Record<string, unknown> }> {
  const parsed = exchangeSchema.safeParse(rawBody);
  if (!parsed.success) return { status: 400, body: { error: 'Ungültiger Request' } };
  // Die redirect_uri MUSS unsere eigene Callback-URL sein — sonst könnte ein
  // Angreifer einen an eine fremde URI gebundenen Code hier einlösen lassen.
  const expected = redirectUriFor(publicUrl, requestUrl);
  if (parsed.data.redirectUri !== expected) {
    return { status: 400, body: { error: 'redirect_uri passt nicht zu diesem Server' } };
  }
  try {
    const { idToken, user } = await oidc.exchangeCode({
      code: parsed.data.code,
      codeVerifier: parsed.data.codeVerifier,
      redirectUri: expected,
    });
    log('info', 'oidc login', { provider: oidc.settings.provider });
    return { status: 200, body: { token: idToken, expiresAt: user.expiresAt, user: { name: user.name, email: user.email } } };
  } catch (err) {
    const kind = err instanceof OidcError ? err.kind : 'config';
    log(kind === 'token' ? 'warn' : 'error', 'oidc exchange failed', { name: err instanceof Error ? err.name : 'unknown', kind });
    return kind === 'token'
      ? { status: 401, body: { error: 'Anmeldung abgelehnt' } }
      : { status: 503, body: { error: 'Identity-Provider nicht erreichbar' } };
  }
}

/**
 * Callback-Seite für das Login-Popup: liest code/state/error aus der URL und
 * reicht sie per postMessage an den Opener (die Extension) — NUR an den
 * eigenen Origin (in Produktion liefert dieselbe Middleware die Extension aus).
 * Ohne Opener (Popup blockiert → Same-Window-Login) geht es per Fragment
 * zurück zur Extension unter "/", die den Code dann selbst einlöst.
 * Kein Token wird hier je gehalten; der Code ist an den PKCE-Verifier gebunden,
 * den nur die Extension kennt.
 */
export const AUTH_CALLBACK_HTML = `<!doctype html>
<html lang="de"><head><meta charset="utf-8" /><title>OpenVizPilot — Anmeldung</title>
<style>body{font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#1b1f24;padding:2rem;text-align:center}</style>
</head><body>
<p id="msg">Anmeldung wird abgeschlossen …</p>
<script>
(function () {
  var params = new URLSearchParams(window.location.search);
  var payload = {
    type: 'openvizpilot-oidc',
    code: params.get('code'),
    state: params.get('state'),
    error: params.get('error'),
    errorDescription: params.get('error_description')
  };
  try { window.history.replaceState(null, '', window.location.pathname); } catch (e) {}
  if (window.opener && !window.opener.closed) {
    window.opener.postMessage(payload, window.location.origin);
    document.getElementById('msg').textContent = 'Anmeldung abgeschlossen — dieses Fenster kann geschlossen werden.';
    setTimeout(function () { window.close(); }, 300);
  } else {
    // Same-Window-Fallback (Popup blockiert): zurück zur Extension, Daten im
    // Fragment — das verlässt den Browser nie und landet in keinem Log.
    var fragment = new URLSearchParams();
    if (payload.code) fragment.set('code', payload.code);
    if (payload.state) fragment.set('state', payload.state);
    if (payload.error) fragment.set('error', payload.error);
    document.getElementById('msg').textContent = 'Zurück zur Extension …';
    window.location.replace(window.location.origin + '/#openvizpilot-oidc&' + fragment.toString());
  }
})();
</script>
</body></html>`;

export function createAuthCallbackRoute(): Hono {
  const app = new Hono();
  app.get('/', (c) => c.html(AUTH_CALLBACK_HTML));
  return app;
}

/** Middleware: verifiziert das Bearer-ID-Token und setzt `authUser` (= sub). */
export function requireOidcUser(oidc: OidcClient, log: AuthLog): MiddlewareHandler<AuthVariables> {
  return async (c, next) => {
    const header = c.req.header('authorization') ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token) {
      return c.json({ error: 'Anmeldung erforderlich', code: 'auth_required' }, 401);
    }
    try {
      const user = await oidc.verifyIdToken(token);
      c.set('authUser', user.sub);
    } catch (err) {
      const kind = err instanceof OidcError ? err.kind : 'config';
      if (kind === 'config') {
        log('error', 'oidc verification unavailable', { name: err instanceof Error ? err.name : 'unknown' });
        return c.json({ error: 'Identity-Provider nicht erreichbar' }, 503);
      }
      return c.json({ error: 'Anmeldung abgelaufen oder ungültig', code: 'auth_required' }, 401);
    }
    await next();
  };
}
