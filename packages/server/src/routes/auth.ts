import { handleOidcExchange, oidcConfigResponse, type AuthLog, type AuthVariables } from '@openvizpilot/ee/server';
import { localLoginSchema, type AuthConfigResponse } from '@openvizpilot/shared';
import { Hono, type MiddlewareHandler } from 'hono';
import {
  hashPassword,
  hashSessionToken,
  LOGIN_FAILURE_WINDOW_MS,
  LOGIN_LOCKOUT_MS,
  LOGIN_MAX_FAILED_ATTEMPTS,
  newSessionToken,
  verifyPassword,
} from '../admin-auth';
import type { AuthStateProvider } from '../auth-state';
import type { Logger } from '../logger';
import type { MemoryStore } from '../memory/store';

/**
 * Anmelde-Handshake der Extension (/api/auth/*) — immer erreichbar (exempt
 * vom API-Schutz), der Modus kommt zur Laufzeit aus dem AuthStateProvider:
 *
 * - GET  /config    Modus + (OIDC) Login-Parameter fürs Login-Gate
 * - POST /login     Open Core: Benutzername/Passwort → Sitzungs-Token (DB)
 * - POST /logout    Sitzung serverseitig beenden
 * - POST /exchange  Enterprise: OIDC-Code + PKCE-Verifier → ID-Token (ee/)
 *
 * Lokale Sitzungen: zufälliges Token, nur der SHA-256-Hash liegt in der DB;
 * Lockout pro Konto wie beim Admin-Login (atomarer Zähler in der DB); nach
 * außen sind unbekannt, gesperrt und falsches Passwort nicht unterscheidbar.
 */

export const USER_SESSION_TTL_MS = 12 * 60 * 60 * 1000;

function bearerOf(header: string | undefined): string {
  return header?.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

/** Middleware für Modus 'local': Bearer-Sitzungstoken → `authUser` = Benutzername. */
export function requireLocalUser(store: MemoryStore): MiddlewareHandler<AuthVariables> {
  return async (c, next) => {
    const token = bearerOf(c.req.header('authorization'));
    if (!token) return c.json({ error: 'Anmeldung erforderlich', code: 'auth_required' }, 401);
    const username = await store.getUserSession(hashSessionToken(token), Date.now());
    if (!username) return c.json({ error: 'Anmeldung abgelaufen oder ungültig', code: 'auth_required' }, 401);
    c.set('authUser', username);
    await next();
  };
}

export function createAuthRoutes(deps: { authState: AuthStateProvider; store: MemoryStore | null; logger: Logger }): Hono<AuthVariables> {
  const { authState, store, logger } = deps;
  const log: AuthLog = (level, msg, data) => logger[level](msg, data);
  const app = new Hono<AuthVariables>();
  // Konstantzeit-Verhalten für unbekannte Konten: immer einen Hash prüfen.
  let dummyHash: Promise<string> | null = null;
  const dummy = () => (dummyHash ??= hashPassword('openvizpilot-dummy-password'));

  app.get('/config', async (c) => {
    const state = await authState.get();
    if (state.blockedReason || (state.mode === 'oidc' && !state.oidc)) {
      return c.json({ mode: state.mode, error: state.blockedReason ?? 'Single Sign-On nicht verfügbar' } satisfies AuthConfigResponse, 503);
    }
    if (state.mode !== 'oidc' || !state.oidc) return c.json({ mode: state.mode } satisfies AuthConfigResponse);
    const result = await oidcConfigResponse(state.oidc, state.publicUrl, c.req.url, log);
    return c.json(result.body, result.status);
  });

  app.post('/login', async (c) => {
    const state = await authState.get();
    if (state.mode !== 'local' || !store) return c.json({ error: 'Passwort-Anmeldung ist nicht aktiv' }, 404);
    const parsed = localLoginSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Benutzername und Passwort erforderlich' }, 400);
    const { username, password } = parsed.data;
    const now = Date.now();
    const user = await store.getUserAuth(username);
    if (!user || user.disabled) {
      await verifyPassword(password, await dummy());
      return c.json({ error: 'Benutzername oder Passwort falsch' }, 401);
    }
    if (user.lockedUntil && user.lockedUntil > now) {
      // Gesperrt: gleiche Antwort wie "falsches Passwort" (kein 429), sonst
      // verriete der Statuscode, welche Benutzernamen existieren.
      await verifyPassword(password, await dummy());
      return c.json({ error: 'Benutzername oder Passwort falsch' }, 401);
    }
    if (!(await verifyPassword(password, user.passwordHash))) {
      const failed = await store.registerFailedUserLogin(username, now, LOGIN_FAILURE_WINDOW_MS);
      if (failed >= LOGIN_MAX_FAILED_ATTEMPTS) {
        await store.lockUser(username, now + LOGIN_LOCKOUT_MS);
        logger.warn('user login locked', { attempts: failed });
      }
      return c.json({ error: 'Benutzername oder Passwort falsch' }, 401);
    }
    await store.resetUserLoginFailures(username);
    const { token, tokenHash } = newSessionToken();
    const expiresAt = now + USER_SESSION_TTL_MS;
    await store.createUserSession(tokenHash, username, expiresAt);
    logger.info('user login');
    return c.json({ token, expiresAt, user: { name: user.displayName || user.username } });
  });

  app.post('/logout', async (c) => {
    const token = bearerOf(c.req.header('authorization'));
    if (token && store) await store.deleteUserSession(hashSessionToken(token));
    return c.json({ ok: true });
  });

  app.post('/exchange', async (c) => {
    const state = await authState.get();
    if (state.mode !== 'oidc') return c.json({ error: 'Single Sign-On ist nicht aktiv' }, 404);
    if (state.blockedReason || !state.oidc) return c.json({ error: state.blockedReason ?? 'Single Sign-On nicht verfügbar' }, 503);
    const result = await handleOidcExchange(state.oidc, await c.req.json().catch(() => null), state.publicUrl, c.req.url, log);
    return c.json(result.body, result.status);
  });

  return app;
}
