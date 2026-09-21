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
  };
}

async function requestWith(tableau: unknown, tableauApi = true) {
  const completion = vi.fn(async () => (async function* () {
    yield { choices: [{ delta: {}, finish_reason: 'stop' }] };
  })());
  const app = new Hono<AuthVariables>();
  app.use('*', async (c, next) => { c.set('userAccess', { ai: true, tableauApi }); await next(); });
  app.route('/', createChatRoute(
    config(), createLogger('error'), { chat: { completions: { create: completion } } } as unknown as OpenAI,
    null, null, async () => false, null, tableau as never,
  ));
  const response = await app.request('/', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ context: '# Dashboard', messages: [{ role: 'user', content: 'Hallo' }] }),
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
