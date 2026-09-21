import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Metric } from '@openvizpilot/shared';
import { createApp } from '../src/app';
import type { AppConfig } from '../src/env';
import { createSqliteMemoryStore, openSqliteDatabase } from '../src/memory/sqlite-store';
import { createLogger } from '../src/logger';
import { findMetricMatches } from '../src/routes/metrics';

// Diese Tests nehmen einen bereits genehmigten AI-Zugriff an.
vi.mock('../src/user-access', () => ({
  requireUserAccess: () => async (c: any, next: () => Promise<void>) => {
    c.set('userAccess', { ai: true, tableauApi: false });
    await next();
  },
}));

/**
 * Kennzahlenkatalog (Trust Layer): Admin-CRUD unter /api/admin/metrics,
 * öffentliche Routen GET /api/metrics & POST /api/metrics/lookup, und die
 * Einbindung in den System-Prompt/die Tool-Liste von /api/chat — Gegenstück
 * zu shared/metrics.ts, routes/metrics.ts, system-prompt.ts und routes/chat.ts.
 */

let upstream: http.Server;
let upstreamUrl: string;
let chatBodies: Array<Record<string, unknown>> = [];

beforeAll(async () => {
  upstream = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url?.endsWith('/chat/completions')) {
      let raw = '';
      req.on('data', (c: Buffer) => (raw += c.toString()));
      req.on('end', () => {
        chatBodies.push(JSON.parse(raw) as Record<string, unknown>);
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
      });
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  upstreamUrl = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => upstream.close((err) => (err ? reject(err) : resolve())));
});

let tmpDirs: string[] = [];

function tmpDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openvizpilot-metrics-'));
  tmpDirs.push(dir);
  return path.join(dir, 'memory.db');
}

afterEach(() => {
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
  tmpDirs = [];
  chatBodies = [];
});

function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    litellmBaseUrl: upstreamUrl,
    litellmApiKey: 'sk-test',
    defaultModel: 'claude-sonnet-5',
    modelAllowlist: null,
    port: 0,
    allowedOrigins: [],
    serveStaticDir: null,
    apiAuthToken: null,
    adminToken: 'geheim',
    memoryDatabaseUrl: null,
    memoryDbPath: tmpDbPath(),
    memoryModel: 'memory-model',
    scopeGuardEnabled: false,
    scopeModel: 'scope-model',
    logLevel: 'error',
    authMode: 'none',
    publicUrl: null,
    oidc: null,
    telemetryEndpoint: '',
    appVersion: 'test',
    environment: 'test',
    licenseEnv: {},
    ...overrides,
  } as AppConfig;
}

const admin = { headers: { authorization: 'Bearer geheim' } };

const DB2: Metric = {
  id: 'deckungsbeitrag-ii',
  name: 'Deckungsbeitrag II',
  synonyms: ['DB2', 'DB II', 'CM2'],
  definition: 'Umsatz − variable Kosten − Fixkosten',
  owner: 'Controlling',
  datasource: 'Finance Semantic Model',
  interpretation: 'Unter 18 % kritisch',
  verifiedQuestions: [{ question: 'Was ist DB2?', answerGuidance: 'Definition wörtlich wiedergeben.' }],
};
const CHURN: Metric = {
  id: 'churn-rate',
  name: 'Abwanderungsrate',
  synonyms: ['Churn'],
  definition: 'Anteil abgewanderter Kunden im Zeitraum',
  verifiedQuestions: [],
};

async function putCatalog(app: ReturnType<typeof createApp>['app'], catalog: unknown) {
  return app.request('/api/admin/metrics', {
    method: 'PUT',
    headers: { 'content-type': 'application/json', authorization: 'Bearer geheim' },
    body: JSON.stringify(catalog),
  });
}

describe('sqlite metric catalog store', () => {
  it('roundtrips and resets', async () => {
    const store = createSqliteMemoryStore(openSqliteDatabase(tmpDbPath()), createLogger('error'));
    expect(await store.getMetricCatalog()).toBeNull();
    await store.setMetricCatalog([DB2]);
    expect(await store.getMetricCatalog()).toEqual([DB2]);
    await store.setMetricCatalog(null);
    expect(await store.getMetricCatalog()).toBeNull();
    await store.close();
  });
});

describe('/api/admin/metrics', () => {
  it('roundtrips: default → custom → reset, and validates input', async () => {
    const { app } = createApp(testConfig());

    let res = await app.request('/api/admin/metrics', admin);
    expect((await res.json()) as object).toEqual({ metrics: [], source: 'default' });

    expect((await putCatalog(app, [{ ...DB2, id: 'Bad Id' }])).status).toBe(400);
    const invalidBody = await (await putCatalog(app, [{ ...DB2, id: 'Bad Id' }])).json();
    expect(invalidBody).toMatchObject({ error: expect.any(String), details: expect.any(Array) });

    expect((await putCatalog(app, [DB2, CHURN])).status).toBe(200);

    res = await app.request('/api/admin/metrics', admin);
    expect((await res.json()) as object).toEqual({ metrics: [DB2, CHURN], source: 'custom' });

    expect((await app.request('/api/admin/metrics', { ...admin, method: 'DELETE' })).status).toBe(200);
    res = await app.request('/api/admin/metrics', admin);
    expect((await res.json()) as object).toEqual({ metrics: [], source: 'default' });
  });

  it('rejects duplicate ids/names across the catalog', async () => {
    const { app } = createApp(testConfig());
    expect((await putCatalog(app, [DB2, { ...DB2, name: 'Anderer Name', synonyms: [] }])).status).toBe(400);
    expect((await putCatalog(app, [DB2, { ...CHURN, name: DB2.name }])).status).toBe(400);
  });

  it('requires the admin token', async () => {
    const { app } = createApp(testConfig());
    expect((await app.request('/api/admin/metrics')).status).toBe(401);
  });
});

describe('GET /api/metrics', () => {
  it('returns an empty list when no catalog is configured', async () => {
    const { app } = createApp(testConfig());
    const res = await app.request('/api/metrics');
    expect(res.status).toBe(200);
    expect((await res.json()) as object).toEqual({ metrics: [] });
  });

  it('returns a compact summary (id, name, synonyms) once a catalog is stored', async () => {
    const { app } = createApp(testConfig());
    await putCatalog(app, [DB2]);
    const res = await app.request('/api/metrics');
    expect((await res.json()) as object).toEqual({
      metrics: [{ id: DB2.id, name: DB2.name, synonyms: DB2.synonyms }],
    });
  });

  it('runs under the same auth regime as /api/commands', async () => {
    const { app } = createApp(testConfig({ authMode: 'token', apiAuthToken: 'shared-secret' }));
    expect((await app.request('/api/metrics')).status).toBe(401);
    expect((await app.request('/api/commands')).status).toBe(401);
    const withToken = { headers: { authorization: 'Bearer shared-secret' } };
    expect((await app.request('/api/metrics', withToken)).status).toBe(200);
    expect((await app.request('/api/commands', withToken)).status).toBe(200);
  });
});

describe('POST /api/metrics/lookup', () => {
  it('finds an exact name or synonym match (case-insensitive)', async () => {
    const { app } = createApp(testConfig());
    await putCatalog(app, [DB2, CHURN]);
    const byName = await app.request('/api/metrics/lookup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: 'deckungsbeitrag ii' }),
    });
    expect((await byName.json()) as { metrics: Metric[] }).toEqual({ metrics: [DB2] });

    const bySynonym = await app.request('/api/metrics/lookup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: 'db2' }),
    });
    expect((await bySynonym.json()) as { metrics: Metric[] }).toEqual({ metrics: [DB2] });
  });

  it('falls back to a substring match when there is no exact hit', async () => {
    const { app } = createApp(testConfig());
    await putCatalog(app, [DB2, CHURN]);
    const res = await app.request('/api/metrics/lookup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: 'wanderung' }),
    });
    expect((await res.json()) as { metrics: Metric[] }).toEqual({ metrics: [CHURN] });
  });

  it('returns an empty array for no match or an empty catalog', async () => {
    const { app } = createApp(testConfig());
    await putCatalog(app, [DB2]);
    const res = await app.request('/api/metrics/lookup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: 'unbekannte-kennzahl' }),
    });
    expect((await res.json()) as object).toEqual({ metrics: [] });

    const { app: emptyApp } = createApp(testConfig());
    const emptyRes = await emptyApp.request('/api/metrics/lookup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: 'db2' }),
    });
    expect((await emptyRes.json()) as object).toEqual({ metrics: [] });
  });

  it('rejects an invalid body', async () => {
    const { app } = createApp(testConfig());
    const res = await app.request('/api/metrics/lookup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: '' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('findMetricMatches', () => {
  it('prefers exact matches over substring matches and caps at 3', () => {
    const catalog: Metric[] = [DB2, CHURN, { ...CHURN, id: 'churn-2', name: 'Churn Rate 2', synonyms: [] }];
    // "DB2" is an exact synonym match on DB2 only.
    expect(findMetricMatches(catalog, 'DB2')).toEqual([DB2]);
    // "churn" is an exact synonym match on CHURN — the substring hit on
    // "Churn Rate 2" is ignored once an exact match exists.
    expect(findMetricMatches(catalog, 'churn').map((m) => m.id)).toEqual(['churn-rate']);
    // "rate" matches neither name/synonym exactly, so both substring hits apply.
    expect(findMetricMatches(catalog, 'rate').map((m) => m.id)).toEqual(['churn-rate', 'churn-2']);
    expect(findMetricMatches(catalog, '')).toEqual([]);
  });
});

describe('chat integration: <metric_catalog> block and lookup_metric tool', () => {
  it('omits the block and tool when no catalog is configured', async () => {
    const { app } = createApp(testConfig());
    const res = await app.request('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ context: '# T', messages: [{ role: 'user', content: 'Hallo' }] }),
    });
    expect(res.status).toBe(200);
    await res.text();
    const body = chatBodies[0]!;
    const system = String((body.messages as Array<{ content?: unknown }>)[0]!.content);
    expect(system).not.toContain('<metric_catalog>');
    const tools = body.tools as Array<{ function: { name: string } }>;
    expect(tools.some((t) => t.function.name === 'lookup_metric')).toBe(false);
  });

  it('injects the rendered catalog and the lookup_metric tool once configured', async () => {
    const { app } = createApp(testConfig());
    await putCatalog(app, [DB2]);
    const res = await app.request('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ context: '# T', messages: [{ role: 'user', content: 'Was ist DB2?' }] }),
    });
    expect(res.status).toBe(200);
    await res.text();
    const body = chatBodies[0]!;
    const system = String((body.messages as Array<{ content?: unknown }>)[0]!.content);
    expect(system).toContain('<metric_catalog>');
    expect(system).toContain('Deckungsbeitrag II');
    expect(system).toContain('lookup_metric');
    const tools = body.tools as Array<{ function: { name: string } }>;
    expect(tools.some((t) => t.function.name === 'lookup_metric')).toBe(true);
  });
});
