import type OpenAI from 'openai';
import { describe, expect, it, vi } from 'vitest';
import { createChatRoute } from '../src/routes/chat';
import type { AppConfig } from '../src/env';
import { createLogger } from '../src/logger';
import { Hono } from 'hono';
import type { AuthVariables } from '@openvizpilot/ee/server';

function config(): AppConfig {
  return {
    litellmBaseUrl: 'https://llm.example.test', litellmApiKey: 'llm-secret', defaultModel: 'model', modelAllowlist: null,
    port: 3000, allowedOrigins: [], serveStaticDir: null, apiAuthToken: null, adminToken: null,
    memoryDatabaseUrl: null, memoryDbPath: null, memoryModel: 'memory', scopeGuardEnabled: false, scopeModel: 'scope',
    logLevel: 'error', authMode: 'none', publicUrl: null, oidc: null, telemetryEndpoint: '', appVersion: 'test', environment: 'test', licenseEnv: {},
    smtpUrl: null, smtpFrom: null, watchEnabled: true, tableauMcp: null,
  };
}

async function requestWith(
  tableau: unknown,
  tableauApi = true,
  options: { serverData?: boolean; hasEeFeature?: (feature: string) => Promise<boolean>; mode?: string; body?: Record<string, unknown>; mcp?: unknown } = {},
) {
  const { serverData = false, hasEeFeature = async () => false, mode, body: extra = {}, mcp = null } = options;
  const completion = vi.fn(async () => (async function* () {
    yield { choices: [{ delta: {}, finish_reason: 'stop' }] };
  })());
  const app = new Hono<AuthVariables>();
  app.use('*', async (c, next) => { c.set('userAccess', { ai: true, tableauApi, serverData }); await next(); });
  app.route('/', createChatRoute(
    config(), createLogger('error'), { chat: { completions: { create: completion } } } as unknown as OpenAI,
    null, null, hasEeFeature as never, mcp as never, tableau as never,
  ));
  const response = await app.request('/', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ context: '# Dashboard', messages: [{ role: 'user', content: 'Hallo' }], ...(mode ? { mode } : {}), ...extra }),
  });
  if (!response.ok) return { status: response.status, tools: [], messages: [], sse: await response.text() };
  const sse = await response.text();
  const calls = completion.mock.calls as unknown as Array<[unknown]>;
  return { status: response.status, ...(calls[0]?.[0] as object), sse } as {
    status: number;
    tools: Array<{ function: { name: string } }>;
    messages: Array<{ content: string }>;
    sse: string;
  };
}

describe('Tableau Server chat tool registry', () => {
  it('omits Tableau tools without the separate API grant even when the service is available', async () => {
    const available = vi.fn(async () => true);
    const body = await requestWith({ available }, false);
    expect(available).not.toHaveBeenCalled();
    expect(body.tools.some(tool => tool.function.name.startsWith('tableau_'))).toBe(false);
  });
  it('omits the Tableau registry and prompt when the service is missing', async () => {
    const body = await requestWith(null);
    expect(body.tools.map((tool) => tool.function.name)).not.toEqual(expect.arrayContaining([
      'tableau_server_search', 'tableau_metadata_search', 'tableau_metadata_field',
    ]));
    expect(body.messages[0]!.content).not.toContain('TABLEAU-SERVER-SUCHE');
  });

  it('adds the Tableau registry and prompt only when available', async () => {
    const available = vi.fn(async () => true);
    const body = await requestWith({ available });
    expect(available).toHaveBeenCalledWith(undefined, undefined);
    expect(body.tools.map((tool) => tool.function.name)).toEqual(expect.arrayContaining([
      'tableau_server_search', 'tableau_metadata_search', 'tableau_metadata_field',
    ]));
    expect(body.messages[0]!.content).toContain('TABLEAU-SERVER-SUCHE');
  });
});

describe('tableau_view_data chat tool registry (W5)', () => {
  const available = () => vi.fn(async () => true);

  it('omits tableau_view_data without the serverData grant even with the license', async () => {
    const body = await requestWith({ available: available() }, true, { serverData: false, hasEeFeature: async () => true });
    expect(body.tools.map((tool) => tool.function.name)).not.toContain('tableau_view_data');
    expect(body.messages[0]!.content).not.toContain('TABLEAU-VIEW-DATEN');
  });

  it('omits tableau_view_data without the license even with the serverData grant', async () => {
    const body = await requestWith({ available: available() }, true, { serverData: true, hasEeFeature: async () => false });
    expect(body.tools.map((tool) => tool.function.name)).not.toContain('tableau_view_data');
    expect(body.messages[0]!.content).not.toContain('TABLEAU-VIEW-DATEN');
  });

  it('adds tableau_view_data and its prompt only with both the license and the grant', async () => {
    const body = await requestWith({ available: available() }, true, { serverData: true, hasEeFeature: async (f) => f === 'serverData' });
    expect(body.tools.map((tool) => tool.function.name)).toContain('tableau_view_data');
    expect(body.messages[0]!.content).toContain('TABLEAU-VIEW-DATEN');
  });
});

describe('mode "investigate-estate" (W7, Cross-Dashboard)', () => {
  const available = () => vi.fn(async () => true);

  it('appends both INVESTIGATE_PROMPT_SECTION and the estate section with the license and the grant, without a downgrade notice', async () => {
    const body = await requestWith({ available: available() }, true, { serverData: true, hasEeFeature: async (f) => f === 'serverData', mode: 'investigate-estate' });
    expect(body.messages[0]!.content).toContain('UNTERSUCHUNGSMODUS');
    expect(body.messages[0]!.content).toContain('UMGEBUNGSWEITE UNTERSUCHUNG');
    expect(body.messages[0]!.content).not.toContain('HINWEIS AN DICH');
  });

  it('downgrades to plain "investigate" without the serverData grant, adding the downgrade notice instead of the estate section', async () => {
    const body = await requestWith({ available: available() }, true, { serverData: false, hasEeFeature: async () => true, mode: 'investigate-estate' });
    expect(body.messages[0]!.content).toContain('UNTERSUCHUNGSMODUS');
    expect(body.messages[0]!.content).not.toContain('UMGEBUNGSWEITE UNTERSUCHUNG');
    expect(body.messages[0]!.content).toContain('HINWEIS AN DICH');
    expect(body.messages[0]!.content).toContain('nicht freigegeben');
  });

  it('downgrades without the serverData licence feature even with the per-user grant', async () => {
    const body = await requestWith({ available: available() }, true, { serverData: true, hasEeFeature: async () => false, mode: 'investigate-estate' });
    expect(body.messages[0]!.content).not.toContain('UMGEBUNGSWEITE UNTERSUCHUNG');
    expect(body.messages[0]!.content).toContain('HINWEIS AN DICH');
  });

  it('shows the downgrade deterministically as the first delta, with a reason, instead of relying on the model', async () => {
    const denied = await requestWith({ available: available() }, true, { serverData: false, hasEeFeature: async () => true, mode: 'investigate-estate' });
    expect(denied.sse).toContain('event: delta');
    expect(denied.sse).toContain('für dich nicht freigegeben');

    const offline = await requestWith({ available: vi.fn(async () => false) }, true, { serverData: true, hasEeFeature: async () => true, mode: 'investigate-estate' });
    expect(offline.tools.some((tool) => tool.function.name.startsWith('tableau_'))).toBe(false);
    expect(offline.sse).toContain('Tableau Server ist für diese Anfrage nicht erreichbar');

    // Fehlende Tableau-API-Freigabe ist eine Freigabe-, keine Verfügbarkeitsfrage.
    const noApiGrant = await requestWith({ available: available() }, false, { serverData: true, hasEeFeature: async () => true, mode: 'investigate-estate' });
    expect(noApiGrant.sse).toContain('nicht freigegeben (Tableau-API)');
    expect(noApiGrant.sse).not.toContain('nicht erreichbar');

    const granted = await requestWith({ available: available() }, true, { serverData: true, hasEeFeature: async (f) => f === 'serverData', mode: 'investigate-estate' });
    expect(granted.sse).not.toContain('Umgebungsweite Untersuchung ist');
  });

  it('plain "investigate" mode never gets the estate section or the downgrade notice, even with full serverData access', async () => {
    const body = await requestWith({ available: available() }, true, { serverData: true, hasEeFeature: async (f) => f === 'serverData', mode: 'investigate' });
    expect(body.messages[0]!.content).toContain('UNTERSUCHUNGSMODUS');
    expect(body.messages[0]!.content).not.toContain('UMGEBUNGSWEITE UNTERSUCHUNG');
    expect(body.messages[0]!.content).not.toContain('HINWEIS AN DICH');
  });
});

// Admin und Autor speichern Dashboard→Site-Zuordnung und MCP-Bereiche unter dem Registrierungsschlüssel
// (`dashboard:<uuid>`); der Dashboard-Name bleibt Statistik-Schlüssel und darf die Auflösung nicht steuern.
describe('dashboard keys for site resolution and MCP', () => {
  const registrationKey = 'dashboard:11111111-1111-4111-8111-111111111111';

  it('resolves the Tableau site and the MCP area by the registration key, not by the dashboard name', async () => {
    const available = vi.fn(async () => true);
    const mcp = { catalogue: vi.fn(async () => []), approvals: vi.fn(async () => ({})) };
    const body = await requestWith({ available }, true, { body: { dashboardKey: 'Sales Overview', registrationKey }, mcp });
    expect(body.status).toBe(200);
    expect(available).toHaveBeenCalledWith(undefined, registrationKey);
    expect(mcp.catalogue).toHaveBeenCalledWith(undefined, registrationKey, expect.any(AbortSignal));
  });

  it('uses the dashboard name only without a registration key (like the tool calls), never for MCP', async () => {
    const available = vi.fn(async () => true);
    const mcp = { catalogue: vi.fn(async () => []), approvals: vi.fn(async () => ({})) };
    await requestWith({ available }, true, { body: { dashboardKey: 'Sales Overview' }, mcp });
    expect(available).toHaveBeenCalledWith(undefined, 'Sales Overview');
    expect(mcp.catalogue).toHaveBeenCalledWith(undefined, undefined, expect.any(AbortSignal));
  });

  it('rejects a registration key that is not a registered-dashboard identity', async () => {
    const available = vi.fn(async () => true);
    for (const bad of ['Sales Overview', 'dashboard:not-a-uuid', 'dashboard:11111111-1111-4111-8111-111111111111x']) {
      const body = await requestWith({ available }, true, { body: { registrationKey: bad } });
      expect(body.status).toBe(400);
    }
    expect(available).not.toHaveBeenCalled();
  });
});
