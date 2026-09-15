import type { AuthVariables } from '@openvizpilot/ee/server';
import type { MiddlewareHandler } from 'hono';
import type { Logger } from './logger';
import type { MemoryStore } from './memory/store';

const pathWithin = (path: string, root: string) => path === root || path.startsWith(`${root}/`);

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
        const local = oidc ? null : await store.getUserAuth(username!);
        if (!oidc && (!local || local.disabled)) return c.json({ error: 'Anmeldung erforderlich', code: 'auth_required' }, 401);
        const record = await store.ensureUserAccess(oidc ? {
          provider: 'oidc', issuer: oidc.issuer, subject: oidc.sub,
          displayName: oidc.name ?? '', email: oidc.email ?? '',
        } : {
          provider: 'local', issuer: '', subject: username!,
          displayName: local!.displayName, email: '',
        });
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
