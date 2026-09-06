import { dashboardRegistrationSchema } from '@openvizpilot/shared';
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import type { MemoryStore } from '../memory/store';
import type { Logger } from '../logger';

/** Mounted behind the same authentication as chat. No dashboard list is exposed to viewers. */
export function createDashboardsRoute(store: MemoryStore | null, logger: Logger): Hono {
  const app = new Hono();
  app.post('/', zValidator('json', dashboardRegistrationSchema), async (c) => {
    if (!store) return c.json({ error: 'Dashboard-Registrierung benötigt eine Datenbank.' }, 503);
    try {
      await store.registerDashboard(c.req.valid('json'));
      return c.body(null, 204);
    } catch (err) {
      logger.warn('dashboard registration failed', { name: err instanceof Error ? err.name : 'unknown' });
      return c.json({ error: 'Dashboard-Registrierung vorübergehend nicht verfügbar.' }, 503);
    }
  });
  return app;
}
