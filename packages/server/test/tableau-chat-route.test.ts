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
    smtpUrl: null, smtpFrom: null, watchEnabled: true,
  };
}

async function requestWith(
  tableau: unknown,
  tableauApi = true,
  options: { serverData?: boolean; hasEeFeature?: (feature: string) => Promise<boolean>; mode?: string } = {},
) {
  const { serverData = false, hasEeFeature = async () => false, mode } = options;
  const completion = vi.fn(async () => (async function* () {
    yield { choices: [{ delta: {}, finish_reason: 'stop' }] };
  })());
  const app = new Hono<AuthVariables>();
  app.use('*', async (c, next) => { c.set('userAccess', { ai: true, tableauApi, serverData }); await next(); });
  app.route('/', createChatRoute(
    config(), createLogger('error'), { chat: { completions: { create: completion } } } as unknown as OpenAI,
    null, null, hasEeFeature as never, null, tableau as never,
  ));
  const response = await app.request('/', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ context: '# Dashboard', messages: [{ role: 'user', content: 'Hallo' }], ...(mode ? { mode } : {}) }),
  });
  await response.text();
  const calls = completion.mock.calls as unknown as Array<[unknown]>;
  return calls[0]?.[0] as {
    tools: Array<{ function: { name: string } }>;
    messages: Array<{ content: string }>;
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

  it('plain "investigate" mode never gets the estate section or the downgrade notice, even with full serverData access', async () => {
    const body = await requestWith({ available: available() }, true, { serverData: true, hasEeFeature: async (f) => f === 'serverData', mode: 'investigate' });
    expect(body.messages[0]!.content).toContain('UNTERSUCHUNGSMODUS');
    expect(body.messages[0]!.content).not.toContain('UMGEBUNGSWEITE UNTERSUCHUNG');
    expect(body.messages[0]!.content).not.toContain('HINWEIS AN DICH');
  });
});
