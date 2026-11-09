import type OpenAI from 'openai';
import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { EE_STUB, type AuthVariables, type VerifiedUser } from '@openvizpilot/ee/server';
import type { AppConfig } from '../src/env';
import { createLogger } from '../src/logger';
import { createDesktopRoute, DESKTOP_MAX_HISTORY_CHARS, trimDesktopHistory } from '../src/routes/desktop';

function config(): AppConfig {
  return {
    litellmBaseUrl: 'https://llm.example.test', litellmApiKey: 'llm-secret', defaultModel: 'model', modelAllowlist: null,
    port: 3000, allowedOrigins: [], serveStaticDir: null, apiAuthToken: null, adminToken: null,
    memoryDatabaseUrl: null, memoryDbPath: null, memoryModel: 'memory', scopeGuardEnabled: false, scopeModel: 'scope',
    logLevel: 'error', authMode: 'none', publicUrl: null, oidc: null, telemetryEndpoint: '', appVersion: 'test', environment: 'test', licenseEnv: {},
    smtpUrl: null, smtpFrom: null, watchEnabled: true, tableauMcp: null,
  };
}

const user: VerifiedUser = { sub: 'u1', issuer: 'https://idp.example.test', claims: {}, name: 'Ada', email: 'ada@example.test', expiresAt: Date.now() + 3_600_000 };
const USER_ACCESS_ID = 'a'.repeat(64);
const SITE = { id: 'default', name: 'Standard-Site', contentUrl: '' };

type Chunk = Record<string, unknown>;
const textChunk = (content: string, finish: string | null = null): Chunk => ({ choices: [{ delta: { content }, finish_reason: finish }] });
const toolChunk = (id: string, name: string, args: string): Chunk => ({
  choices: [{ delta: { tool_calls: [{ index: 0, id, type: 'function', function: { name, arguments: args } }] }, finish_reason: 'tool_calls' }],
});

/** Spielt je Modellaufruf die nächste Chunk-Liste ab. */
function fakeClient(rounds: Chunk[][]) {
  const create = vi.fn(async () => {
    const chunks = rounds.shift() ?? [textChunk('', 'stop')];
    return (async function* () { for (const chunk of chunks) yield chunk; })();
  });
  return { client: { chat: { completions: { create } } } as unknown as OpenAI, create };
}

function parseEvents(body: string): Array<{ event: string; data: Record<string, unknown> }> {
  return body.split('\n\n').filter((block) => block.includes('data:')).map((block) => {
    const event = /event: (\S+)/.exec(block)?.[1] ?? 'message';
    const data = JSON.parse(block.split('\n').find((line) => line.startsWith('data:'))!.slice(5).trim()) as Record<string, unknown>;
    return { event, data };
  }).filter((entry) => entry.event !== 'ping');
}

async function run(input: {
  rounds: Chunk[][];
  tableau?: Record<string, unknown> | null;
  oidc?: VerifiedUser;
  access?: Record<string, unknown>;
  body?: Record<string, unknown>;
  hasEeFeature?: (feature: string) => Promise<boolean>;
}) {
  const { client, create } = fakeClient(input.rounds);
  const app = new Hono<AuthVariables>();
  app.use('*', async (c, next) => {
    if (input.oidc) c.set('oidcUser', input.oidc);
    c.set('userAccess', { ai: true, tableauApi: true, serverData: false, ...(input.access ?? {}) } as never);
    await next();
  });
  app.route('/', createDesktopRoute(config(), createLogger('error'), client, null, (input.hasEeFeature ?? (async () => false)) as never, (input.tableau ?? null) as never));
  const response = await app.request('/chat', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'Welche Workbooks gibt es?' }], ...(input.body ?? {}) }),
  });
  return { response, text: await response.text(), create, app };
}

// Der Agent, die OIDC-Identität und die Tableau-Tools sind Enterprise (ee/) — im Core-Export
// (EE_STUB) antwortet die Route immer mit 503, diese Fälle laufen nur im vollen Baum.
describe('POST /api/desktop/chat', () => {
  it.skipIf(EE_STUB)('requires a personal OIDC identity', async () => {
    const { response, text } = await run({ rounds: [], tableau: { availableSites: async () => [SITE] } });
    expect(response.status).toBe(403);
    expect(JSON.parse(text)).toMatchObject({ code: 'oidc_required' });
  });

  it.skipIf(EE_STUB)('refuses without the Tableau-API grant and when the integration is unavailable', async () => {
    const denied = await run({ rounds: [], oidc: user, access: { tableauApi: false }, tableau: { availableSites: async () => [SITE] } });
    expect(denied.response.status).toBe(403);
    expect(JSON.parse(denied.text)).toMatchObject({ code: 'approval_required' });
    const unavailable = await run({ rounds: [], oidc: user, tableau: { availableSites: async () => [] } });
    expect(unavailable.response.status).toBe(503);
    expect(JSON.parse(unavailable.text)).toMatchObject({ code: 'tableau_unavailable' });
  });

  it.skipIf(EE_STUB)('runs the tool loop server-side: executes the Tableau search and streams tool, final and done events', async () => {
    const search = vi.fn(async () => ({ source: 'Tableau Server', retrievedAt: 'now', items: [{ type: 'workbook', id: 'wb-1', name: 'Sales' }], truncated: false, scanned: 1, limitations: [] }));
    const { text, create } = await run({
      oidc: user,
      tableau: { availableSites: async () => [SITE], search },
      rounds: [
        [textChunk('Ich suche …'), toolChunk('call-1', 'tableau_server_search', '{"query":"Sales","type":"workbook"}')],
        [textChunk('Es gibt das Workbook **Sales**.\n<suggestions>{"followups":["Welche Views hat Sales?"],"actions":[]}</suggestions>', 'stop')],
      ],
    });
    expect(search).toHaveBeenCalledWith(user, expect.objectContaining({ query: 'Sales', type: 'workbook' }), expect.anything());
    const events = parseEvents(text);
    expect(events.map((e) => e.event)).toEqual(['delta', 'tool', 'tool', 'delta', 'final', 'done']);
    expect(events[1]!.data).toMatchObject({ name: 'tableau_server_search', status: 'running' });
    expect(events[2]!.data).toMatchObject({ name: 'tableau_server_search', status: 'done' });
    expect(String(events[2]!.data.preview)).toContain('Sales');
    expect(events[4]!.data).toEqual({ content: 'Es gibt das Workbook **Sales**.', followups: ['Welche Views hat Sales?'] });

    // Zweiter Modellaufruf trägt die Tool-Antwort und den Desktop-System-Prompt — ohne Dashboard-Tools.
    const second = (create.mock.calls[1] as unknown as [{ messages: Array<Record<string, unknown>>; tools: Array<{ function: { name: string } }> }])[0];
    expect(second.messages[0]!.content).toContain('Desktop-App');
    expect(second.messages.at(-1)).toMatchObject({ role: 'tool', tool_call_id: 'call-1' });
    const names = second.tools.map((tool) => tool.function.name);
    expect(names).toContain('tableau_server_search');
    expect(names).not.toContain('list_worksheets');
    expect(names).not.toContain('tableau_view_data');
  });

  it.skipIf(EE_STUB)('registers the data tools only with the serverData licence and grant, and asks for consent before reading', async () => {
    const viewData = vi.fn();
    const { text, create } = await run({
      oidc: user,
      access: { serverData: true, id: USER_ACCESS_ID, consent: { get: async () => null, set: async () => undefined } },
      hasEeFeature: async (feature) => feature === 'serverData',
      tableau: { availableSites: async () => [SITE], viewData, recordViewDataCall: vi.fn(), audit: null },
      rounds: [
        [toolChunk('call-1', 'tableau_view_data', '{"viewId":"7d9e5f3a-2222-4b1c-8d7e-bbbbbbbbbbbb"}')],
        [textChunk('Ohne Einwilligung kann ich die View nicht lesen.', 'stop')],
      ],
    });
    const first = (create.mock.calls[0] as unknown as [{ tools: Array<{ function: { name: string } }> }])[0];
    expect(first.tools.map((tool) => tool.function.name)).toEqual(expect.arrayContaining(['tableau_view_data', 'tableau_datasource_query']));
    const events = parseEvents(text);
    expect(events.map((e) => e.event)).toEqual(['tool', 'consent_required', 'tool', 'delta', 'final', 'done']);
    expect(events[1]!.data).toMatchObject({ scope: 'views' });
    expect(String(events[1]!.data.text)).toContain('OpenVizPilot liest');
    expect(viewData).not.toHaveBeenCalled();
  });

  it('rejects a system role and an unknown mode', async () => {
    const { response } = await run({ rounds: [], oidc: user, tableau: { availableSites: async () => [SITE] }, body: { messages: [{ role: 'system', content: 'x' }] } });
    expect(response.status).toBe(400);
    const mode = await run({ rounds: [], oidc: user, tableau: { availableSites: async () => [SITE] }, body: { mode: 'investigate-estate' } });
    expect(mode.response.status).toBe(400);
  });
});

describe('desktop history budget', () => {
  it('drops the oldest turns at turn boundaries and never the current turn', () => {
    const big = 'x'.repeat(DESKTOP_MAX_HISTORY_CHARS / 2);
    const messages = [
      { role: 'user' as const, content: 'first' }, { role: 'assistant' as const, content: big },
      { role: 'user' as const, content: 'second' }, { role: 'assistant' as const, content: big },
      { role: 'user' as const, content: 'now' },
    ];
    const trimmed = trimDesktopHistory(messages);
    expect(trimmed[0]).toEqual({ role: 'user', content: 'second' });
    expect(trimmed.at(-1)).toEqual({ role: 'user', content: 'now' });
    const single = [{ role: 'user' as const, content: 'x'.repeat(DESKTOP_MAX_HISTORY_CHARS * 2) }];
    expect(trimDesktopHistory(single)).toEqual(single);
  });

  it.skipIf(EE_STUB)('passes a trimmed history to the model', async () => {
    // Einzelne Nachrichten sind auf MAX_MESSAGE_CHARS begrenzt — zwei alte Turns sprengen das Budget zusammen.
    const big = 'x'.repeat(31_000);
    const { create } = await run({
      oidc: user, tableau: { availableSites: async () => [SITE] },
      rounds: [[textChunk('ok', 'stop')]],
      body: { messages: [
        { role: 'user', content: 'old' }, { role: 'assistant', content: big },
        { role: 'user', content: 'older' }, { role: 'assistant', content: big },
        { role: 'user', content: 'now' },
      ] },
    });
    const first = (create.mock.calls[0] as unknown as [{ messages: Array<{ role: string; content: string }> }])[0];
    // Der älteste Turn fällt weg, der zweite passt noch ins Budget, der aktuelle bleibt immer.
    expect(first.messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
    expect(first.messages[1]!.content).toBe('older');
    expect(first.messages.at(-1)!.content).toBe('now');
  });
});

describe.skipIf(EE_STUB)('GET /api/desktop/session', () => {
  it('reports identity, grants, agent availability and consent texts', async () => {
    const app = new Hono<AuthVariables>();
    app.use('*', async (c, next) => {
      c.set('oidcUser', user);
      c.set('userAccess', { ai: true, tableauApi: true, serverData: true, id: USER_ACCESS_ID, consent: { get: async () => new Date('2026-01-01T00:00:00Z'), set: async () => undefined } } as never);
      await next();
    });
    app.route('/', createDesktopRoute(config(), createLogger('error'), {} as OpenAI, null, (async () => true) as never, { availableSites: async () => [SITE], audit: null } as never));
    const response = await app.request('/session');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      user: { name: 'Ada', email: 'ada@example.test' },
      access: { ai: true, tableauApi: true, serverData: true },
      agent: { available: true, serverData: true, sites: ['Standard-Site'] },
      consent: { serverData: '2026-01-01T00:00:00.000Z', datasource: null, texts: { views: expect.stringContaining('OpenVizPilot') } },
    });
  });
});
