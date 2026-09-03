import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { modelCatalogSchema } from '@openvizpilot/shared';
import { effectiveDefaultModel, resolveModel } from '../src/routes/chat';
import { createApp } from '../src/app';
import type { AppConfig } from '../src/env';
import { createSqliteMemoryStore, openSqliteDatabase } from '../src/memory/sqlite-store';
import { createLogger } from '../src/logger';

/**
 * Admin-verwalteter Modell-Katalog: GET /api/models, Chat-Validierung und die
 * /api/admin/models-Endpunkte — Gegenstück zu shared/models.ts,
 * routes/models.ts und routes/admin.ts.
 */

let upstream: http.Server;
let upstreamUrl: string;
/** Modell-IDs, die der Fixture-Endpunkt unter GET /models meldet. */
let upstreamModels: string[] = ['claude-sonnet-5', 'gpt-5', 'haiku-4-5'];
/** Alle empfangenen /chat/completions-Bodies. */
let chatBodies: Array<Record<string, unknown>> = [];

beforeAll(async () => {
  upstream = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url?.endsWith('/models')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ object: 'list', data: upstreamModels.map((id) => ({ id, object: 'model' })) }));
      return;
    }
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openvizpilot-models-'));
  tmpDirs.push(dir);
  return path.join(dir, 'memory.db');
}

afterEach(() => {
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
  tmpDirs = [];
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
    // Tests senden nie nach außen.
    telemetryEndpoint: '',
    appVersion: 'test',
    licenseEnv: {},
    ...overrides,
  };
}

const auth = { headers: { authorization: 'Bearer geheim' } };
const CATALOG = [
  { id: 'claude-sonnet-5', label: 'Standard (empfohlen)' },
  { id: 'haiku-4-5', label: 'Schnell & günstig' },
];

async function putCatalog(app: ReturnType<typeof createApp>['app'], catalog: unknown) {
  return app.request('/api/admin/models', {
    method: 'PUT',
    headers: { 'content-type': 'application/json', authorization: 'Bearer geheim' },
    body: JSON.stringify(catalog),
  });
}

describe('modelCatalogSchema', () => {
  it('requires unique ids and labels and at least one entry', () => {
    expect(modelCatalogSchema.safeParse(CATALOG).success).toBe(true);
    expect(modelCatalogSchema.safeParse([]).success).toBe(false);
    expect(
      modelCatalogSchema.safeParse([
        { id: 'a', label: 'X' },
        { id: 'a', label: 'Y' },
      ]).success,
    ).toBe(false);
    expect(
      modelCatalogSchema.safeParse([
        { id: 'a', label: 'X' },
        { id: 'b', label: 'X' },
      ]).success,
    ).toBe(false);
    expect(modelCatalogSchema.safeParse([{ id: '', label: 'X' }]).success).toBe(false);
  });
});

describe('sqlite model catalog store', () => {
  it('roundtrips and resets', async () => {
    const store = createSqliteMemoryStore(openSqliteDatabase(tmpDbPath()), createLogger('error'));
    expect(await store.getModelCatalog()).toBeNull();
    await store.setModelCatalog(CATALOG);
    expect(await store.getModelCatalog()).toEqual(CATALOG);
    await store.setModelCatalog(null);
    expect(await store.getModelCatalog()).toBeNull();
    await store.close();
  });
});

describe('GET /api/models', () => {
  it('serves the upstream list as id/label pairs when no catalog is stored', async () => {
    const { app } = createApp(testConfig());
    const res = await app.request('/api/models');
    const data = (await res.json()) as { models: Array<{ id: string; label: string }>; defaultModel: string };
    expect(data.defaultModel).toBe('claude-sonnet-5');
    expect(data.models).toEqual([
      { id: 'claude-sonnet-5', label: 'claude-sonnet-5' },
      { id: 'gpt-5', label: 'gpt-5' },
      { id: 'haiku-4-5', label: 'haiku-4-5' },
    ]);
  });

  it('serves ONLY the admin catalog once stored', async () => {
    const { app } = createApp(testConfig());
    expect((await putCatalog(app, CATALOG)).status).toBe(200);
    const res = await app.request('/api/models');
    const data = (await res.json()) as { models: unknown };
    expect(data.models).toEqual(CATALOG);
  });
});

describe('resolveModel', () => {
  const catalog = CATALOG;
  const base = { defaultModel: 'claude-sonnet-5', envAllowlist: null, catalog: null, catalogFailed: false };

  it('uses the catalog for the implicit default path (first entry when default is excluded)', () => {
    expect(resolveModel({ ...base, catalog })).toEqual({ ok: true, model: 'claude-sonnet-5' });
    const excluding = [{ id: 'haiku-4-5', label: 'Schnell' }];
    expect(resolveModel({ ...base, catalog: excluding })).toEqual({ ok: true, model: 'haiku-4-5' });
    expect(effectiveDefaultModel('claude-sonnet-5', excluding)).toBe('haiku-4-5');
  });

  it('rejects a requested model outside the catalog — even the env default', () => {
    const excluding = [{ id: 'haiku-4-5', label: 'Schnell' }];
    expect(resolveModel({ ...base, catalog: excluding, requested: 'claude-sonnet-5' })).toEqual({ ok: false });
    expect(resolveModel({ ...base, catalog: excluding, requested: 'haiku-4-5' })).toEqual({ ok: true, model: 'haiku-4-5' });
  });

  it('fails CLOSED when the catalog read failed: only allowlist/default remain', () => {
    // Ohne Env-Allowlist ist bei Katalog-Lesefehler NUR das Default-Modell erlaubt.
    expect(resolveModel({ ...base, catalogFailed: true, requested: 'gpt-5' })).toEqual({ ok: false });
    expect(resolveModel({ ...base, catalogFailed: true, requested: 'claude-sonnet-5' })).toEqual({
      ok: true,
      model: 'claude-sonnet-5',
    });
    expect(
      resolveModel({ ...base, envAllowlist: ['gpt-5'], catalogFailed: true, requested: 'gpt-5' }),
    ).toEqual({ ok: true, model: 'gpt-5' });
  });

  it('keeps the env-allowlist behavior when no catalog exists', () => {
    expect(resolveModel({ ...base, requested: 'irgendwas' })).toEqual({ ok: true, model: 'irgendwas' });
    expect(resolveModel({ ...base, envAllowlist: ['gpt-5'], requested: 'irgendwas' })).toEqual({ ok: false });
    expect(resolveModel(base)).toEqual({ ok: true, model: 'claude-sonnet-5' });
  });
});

describe('chat model validation with catalog', () => {
  it('applies the catalog to the implicit default path too', async () => {
    const { app } = createApp(testConfig({ defaultModel: 'gpt-5' }));
    // Katalog schließt das konfigurierte Default (gpt-5) bewusst aus.
    await putCatalog(app, CATALOG);

    // GET /api/models meldet das effektive Default (erster Katalog-Eintrag).
    const models = (await (await app.request('/api/models')).json()) as { defaultModel: string };
    expect(models.defaultModel).toBe('claude-sonnet-5');

    // Chat OHNE model-Feld nutzt das effektive Default — nie das ausgeschlossene gpt-5.
    chatBodies = [];
    const res = await app.request('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ context: '# T', messages: [{ role: 'user', content: 'Hallo' }] }),
    });
    expect(res.status).toBe(200);
    await res.text();
    expect(chatBodies[0]!.model).toBe('claude-sonnet-5');
  });

  it('accepts catalog models and rejects everything else — the catalog overrides MODEL_ALLOWLIST', async () => {
    const { app } = createApp(testConfig({ modelAllowlist: ['gpt-5'] }));
    await putCatalog(app, CATALOG);

    const post = (model: string) =>
      app.request('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ context: '# Test', model, messages: [{ role: 'user', content: 'Hallo' }] }),
      });

    expect((await post('haiku-4-5')).status).toBe(200);
    // gpt-5 steht in der Env-Allowlist, aber NICHT im Katalog → abgelehnt.
    expect((await post('gpt-5')).status).toBe(400);
    expect((await post('unbekannt')).status).toBe(400);
  });
});

describe('/api/admin/models', () => {
  it('roundtrips: default → custom → reset, and validates input', async () => {
    const { app } = createApp(testConfig());

    let res = await app.request('/api/admin/models', auth);
    expect((await res.json()) as object).toEqual({ models: [], source: 'default' });

    expect((await putCatalog(app, [{ id: 'a', label: 'X' }, { id: 'a', label: 'Y' }])).status).toBe(400);
    expect((await putCatalog(app, CATALOG)).status).toBe(200);

    res = await app.request('/api/admin/models', auth);
    expect((await res.json()) as object).toEqual({ models: CATALOG, source: 'custom' });

    expect((await app.request('/api/admin/models', { ...auth, method: 'DELETE' })).status).toBe(200);
    res = await app.request('/api/admin/models', auth);
    expect((await res.json()) as object).toEqual({ models: [], source: 'default' });
  });

  it('requires auth', async () => {
    const { app } = createApp(testConfig());
    expect((await app.request('/api/admin/models')).status).toBe(401);
  });

  it('lists raw upstream models for the lookup (unfiltered by allowlist)', async () => {
    const { app } = createApp(testConfig({ modelAllowlist: ['gpt-5'] }));
    const res = await app.request('/api/admin/upstream-models', auth);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { models: string[] }).models).toEqual([
      'claude-sonnet-5',
      'gpt-5',
      'haiku-4-5',
    ]);
  });

  it('returns 502 when the endpoint is unreachable', async () => {
    const { app } = createApp(testConfig({ litellmBaseUrl: 'http://127.0.0.1:1' }));
    expect((await app.request('/api/admin/upstream-models', auth)).status).toBe(502);
  });
});
