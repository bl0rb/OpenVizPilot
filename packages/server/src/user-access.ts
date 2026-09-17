import type { AuthVariables, VerifiedUser } from '@openvizpilot/ee/server';
import type { MiddlewareHandler } from 'hono';
import type { Logger } from './logger';
import type { MemoryStore, UserAccess } from './memory/store';

const pathWithin = (path: string, root: string) => path === root || path.startsWith(`${root}/`);

/**
 * Löst die verifizierte Identität (OIDC-ID-Token bzw. lokale Sitzung) in ihren
 * Access-Record auf — gemeinsamer Weg für die API-Freigaben und den
 * Admin-Zugang delegierter Admins. null = lokales Konto unbekannt oder
 * gesperrt (darf nie durch). Store-Fehler werden durchgereicht.
 */
export async function resolveUserAccess(
  store: MemoryStore,
  identity: { oidc?: VerifiedUser; username?: string },
): Promise<UserAccess | null> {
  const { oidc, username } = identity;
  const local = oidc ? null : await store.getUserAuth(username!);
  if (!oidc && (!local || local.disabled)) return null;
  return store.ensureUserAccess(oidc ? {
    provider: 'oidc', issuer: oidc.issuer, subject: oidc.sub,
    displayName: oidc.name ?? '', email: oidc.email ?? '',
  } : {
    provider: 'local', issuer: '', subject: username!,
    displayName: local!.displayName, email: '',
  });
}

/** Authentication identifies the user; only persisted admin grants authorize usage. */
export function requireUserAccess(store: MemoryStore | null, logger: Logger): MiddlewareHandler<AuthVariables> {
  return async (c, next) => {
    if (pathWithin(c.req.path, '/api/admin') || pathWithin(c.req.path, '/api/auth')) return next();
    const oidc = c.get('oidcUser');
    const username = c.get('authUser');
    let access = { ai: false, tableauApi: false };
    try {
      if (oidc || username) {
        if (!store) throw new Error('User access store unavailable');
        const record = await resolveUserAccess(store, { oidc, username });
        if (!record) return c.json({ error: 'Anmeldung erforderlich', code: 'auth_required' }, 401);
        access = { ai: record.ai, tableauApi: record.tableauApi };
      }
    } catch {
      logger.error('user access unavailable');
      return c.json({ error: 'Freigabestatus nicht verfügbar', code: 'access_unavailable' }, 503);
    }
    c.set('userAccess', access);
    c.header('Cache-Control', 'no-store');
    const capability = pathWithin(c.req.path, '/api/tableau-server') ? 'tableauApi'
      : ['/api/chat', '/api/models', '/api/mcp', '/api/memory'].some(root => pathWithin(c.req.path, root)) ? 'ai' : null;
    if (capability && !access[capability]) {
      return c.json({
        error: capability === 'ai' ? 'KI-Nutzung ist noch nicht freigegeben.' : 'Tableau-API ist noch nicht freigegeben.',
        code: 'approval_required', capability,
      }, 403);
    }
    await next();
  };
}
