import { zValidator } from '@hono/zod-validator';
import { mcpEndpointSchema, mcpExecutionSchema, mcpSettingsUpdateSchema } from './schema';
import type { AuthVariables } from '../auth-routes';
import { Hono } from 'hono';
import type { McpStore } from './store';
import { McpGateway } from './gateway';
import { resolveMcpServer } from './config';
import type { McpService } from './service';
import type { PersonalizationLogger } from '../personalization';
import type { EeFeature } from '../license';
import type { RegisteredDashboard } from '@openvizpilot/shared';

export function createMcpAdminRoute(store: McpStore | null, directory: {
  listDashboards(): Promise<RegisteredDashboard[]>;
  listUsers(): Promise<Array<{ username: string; displayName: string; disabled: boolean }>>;
}, logger: PersonalizationLogger, hasFeature: (feature: EeFeature) => Promise<boolean>): Hono {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.header('cache-control', 'no-store');
    if (!(await hasFeature('mcp'))) return c.json({ error: 'Enterprise-Lizenz mit MCP erforderlich.', code: 'license_required' }, 402);
    if (!store) return c.json({ error: 'MCP-Verwaltung benötigt eine Datenbank.' }, 503);
    await next();
  });
  app.get('/', async (c) => {
    try {
      const state = await store!.getMcpSettings();
      const dashboards = await directory.listDashboards();
      const users = (await directory.listUsers()).filter((user) => !user.disabled).map((user) => ({ id: `local:${user.username}`, name: user.displayName || user.username }));
      return c.json({ ...state, dashboards, users });
    } catch {
      return c.json({ error: 'MCP-Konfiguration nicht verfügbar.' }, 503);
    }
  });
  app.put('/', zValidator('json', mcpSettingsUpdateSchema), async (c) => {
    const { settings, revision } = c.req.valid('json');
    try {
      const dashboards = await directory.listDashboards();
      if (settings.sites.some((site) => site.dashboardKeys.some((key) => !dashboards.some((dashboard) => dashboard.dashboardKey === key)))) {
        return c.json({ error: 'Unbekanntes Dashboard in der Site-Zuordnung.' }, 400);
      }
      if (!(await store!.setMcpSettings(settings, revision))) return c.json({ error: 'Konfiguration wurde zwischenzeitlich geändert. Bitte neu laden.' }, 409);
      logger.info('admin mcp settings updated', { servers: settings.servers.length, sites: settings.sites.length });
      return c.json({ revision: revision + 1 });
    } catch {
      return c.json({ error: 'MCP-Konfiguration konnte nicht gespeichert werden.' }, 503);
    }
  });
  app.post('/probe', zValidator('json', mcpEndpointSchema), async (c) => {
    try {
      const server = resolveMcpServer({ ...c.req.valid('json'), tools: [] });
      const tools = await new McpGateway([server]).probe(c.req.raw.signal);
      return c.json({ tools });
    } catch {
      return c.json({ error: 'MCP-Verbindung fehlgeschlagen. HTTPS-Endpunkt, Secret-Referenz und Streamable-HTTP-Unterstützung prüfen.' }, 502);
    }
  });
  return app;
}

export function createMcpRoute(service: McpService | null, logger: PersonalizationLogger, hasFeature: (feature: EeFeature) => Promise<boolean>): Hono<AuthVariables> {
  const app = new Hono<AuthVariables>();
  app.post('/', zValidator('json', mcpExecutionSchema), async (c) => {
    c.header('cache-control', 'no-store');
    if (!(await hasFeature('mcp'))) return c.json({ error: 'Enterprise-Lizenz mit MCP erforderlich.', code: 'license_required' }, 402);
    if (!service) return c.json({ error: 'MCP ist nicht aktiviert.' }, 503);
    if (!c.get('authUser')) return c.json({ error: 'MCP benötigt eine persönliche Anmeldung.' }, 403);
    const { call, dashboardKey, ticket } = c.req.valid('json');
    try {
      const content = await service.execute(c.get('authUser'), dashboardKey, call, ticket, c.req.raw.signal);
      logger.info('mcp tool completed', { tool: call.function.name });
      return c.json({ content });
    } catch {
      logger.warn('mcp tool failed or denied', { tool: call.function.name });
      return c.json({ error: 'Externe Abfrage nicht verfügbar oder nicht mehr freigegeben. Bitte die Frage erneut senden.' }, 403);
    }
  });
  return app;
}