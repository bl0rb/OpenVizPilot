import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import type { AppConfig } from '../src/env';

/**
 * LLM-Endpunkt in der Admin-UI: Anzeige der wirksamen Konfiguration, Verbindungstest und
 * dauerhafte Überschreibung (routes/admin.ts, llm/endpoint.ts). Zwei Fixture-Endpunkte
 * (Env und Überschreibung) protokollieren den Authorization-Header — so ist prüfbar, dass
 * kein Key an eine Adresse geht, für die er nicht eingetragen wurde.
 */

const ENV_KEY = 'sk-env-0123456789abcd';
const OVERRIDE_KEY = 'sk-override-0123456789wxyz';
const SECRET = 'x'.repeat(40);

interface Fixture {
  server: http.Server;
  url: string;
  auth: string[];
}

function startFixture(key: string, models: string[]): Promise<Fixture> {
  const fixture = { auth: [] as string[] } as Fixture;
  fixture.server = http.createServer((req, res) => {
    fixture.auth.push(req.headers.authorization ?? '');
    if (req.headers.authorization !== `Bearer ${key}`) {
      res.writeHead(401, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { message: 'bad key' } }));
      return;
    }
    if (req.method === 'GET' && req.url === '/v1/models') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ object: 'list', data: models.map((id) => ({ id, object: 'model' })) }));
      return;
    }
    res.writeHead(404).end();
  });
  return new Promise((resolve) =>
    fixture.server.listen(0, '127.0.0.1', () => {
      fixture.url = `http://127.0.0.1:${(fixture.server.address() as AddressInfo).port}/v1`;
      resolve(fixture);
    }),
  );
}

let envLlm: Fixture;
let overrideLlm: Fixture;

beforeAll(async () => {
  envLlm = await startFixture(ENV_KEY, ['env-model']);
  overrideLlm = await startFixture(OVERRIDE_KEY, ['claude-sonnet-5', 'other']);
});

afterAll(async () => {
  for (const f of [envLlm, overrideLlm]) await new Promise<void>((resolve) => f.server.close(() => resolve()));
});

let tmpDirs: string[] = [];

beforeEach(() => {
  vi.stubEnv('OVP_SECRET_KEY', SECRET);
  envLlm.auth = [];
  overrideLlm.auth = [];
});

afterEach(() => {
  vi.unstubAllEnvs();
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
  tmpDirs = [];
});

function tmpDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openvizpilot-llm-'));
  tmpDirs.push(dir);
  return path.join(dir, 'memory.db');
}

function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    litellmBaseUrl: envLlm.url,
    litellmApiKey: ENV_KEY,
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
    smtpUrl: null,
    smtpFrom: null,
    watchEnabled: true,
    tableauMcp: null,
    ...overrides,
  };
}

type App = ReturnType<typeof createApp>['app'];
const auth = { authorization: 'Bearer geheim' };

function send(app: App, method: string, url: string, body?: unknown) {
  return app.request(`/api/admin${url}`, {
    method,
    headers: { ...auth, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function json(res: Response): Promise<any> {
  return res.json();
}

describe('GET /api/admin/llm-endpoint', () => {
  it('requires the admin token', async () => {
    const { app } = createApp(testConfig());
    expect((await app.request('/api/admin/llm-endpoint')).status).toBe(401);
    expect((await app.request('/api/admin/llm-endpoint', { headers: { authorization: 'Bearer falsch' } })).status).toBe(401);
    const put = await app.request('/api/admin/llm-endpoint', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ baseUrl: overrideLlm.url, apiKey: OVERRIDE_KEY }),
    });
    expect(put.status).toBe(401);
  });

  it('shows the env configuration without the key in plain text', async () => {
    const { app } = createApp(testConfig());
    const res = await send(app, 'GET', '/llm-endpoint');
    const raw = await res.text();
    expect(res.status).toBe(200);
    expect(raw).not.toContain(ENV_KEY);
    const data = JSON.parse(raw);
    expect(data.effective).toMatchObject({ source: 'env', baseUrl: envLlm.url, apiKeyHint: '…abcd', blockedReason: null });
    expect(data).toMatchObject({ timeoutMs: 120_000, maxRetries: 0, defaultModel: 'claude-sonnet-5', canOverride: true, secretKeyConfigured: true, stored: null });
  });
});

describe('POST /api/admin/llm-endpoint/test', () => {
  it('tests the effective endpoint with details', async () => {
    const { app } = createApp(testConfig());
    const data = await json(await send(app, 'POST', '/llm-endpoint/test', {}));
    expect(data).toMatchObject({
      ok: true,
      source: 'env',
      status: 200,
      requestUrl: `${envLlm.url}/models`,
      modelCount: 1,
      defaultModel: 'claude-sonnet-5',
      defaultModelListed: false,
      error: null,
    });
  });

  it('refuses to send the effective key to another address', async () => {
    const { app } = createApp(testConfig());
    const res = await send(app, 'POST', '/llm-endpoint/test', { baseUrl: overrideLlm.url });
    expect(res.status).toBe(400);
    expect((await json(res)).code).toBe('api_key_required');
    expect(overrideLlm.auth).toEqual([]);
  });

  it('classifies rejected keys, missing paths and unreachable hosts', async () => {
    const { app } = createApp(testConfig());
    const wrongKey = await json(await send(app, 'POST', '/llm-endpoint/test', { baseUrl: overrideLlm.url, apiKey: 'sk-falsch' }));
    expect(wrongKey).toMatchObject({ ok: false, source: 'form', status: 401, error: { kind: 'auth' } });
    const noV1 = await json(await send(app, 'POST', '/llm-endpoint/test', { baseUrl: overrideLlm.url.replace(/\/v1$/, ''), apiKey: OVERRIDE_KEY }));
    expect(noV1).toMatchObject({ ok: false, status: 404, error: { kind: 'not_found' } });
    const down = await json(await send(app, 'POST', '/llm-endpoint/test', { baseUrl: 'http://127.0.0.1:1/v1', apiKey: OVERRIDE_KEY }));
    expect(down).toMatchObject({ ok: false, status: null, error: { kind: 'network' } });
  });

  it('rejects non-http addresses', async () => {
    const { app } = createApp(testConfig());
    expect((await send(app, 'POST', '/llm-endpoint/test', { baseUrl: 'ftp://example.com', apiKey: 'k' })).status).toBe(400);
    expect((await send(app, 'PUT', '/llm-endpoint', { baseUrl: 'file:///etc/passwd', apiKey: 'k' })).status).toBe(400);
  });
});

describe('PUT/DELETE /api/admin/llm-endpoint', () => {
  it('overrides the endpoint for all LLM calls and resets to env', async () => {
    const config = testConfig();
    const { app } = createApp(config);
    expect((await send(app, 'PUT', '/llm-endpoint', { baseUrl: `${overrideLlm.url}/`, apiKey: OVERRIDE_KEY })).status).toBe(200);

    const data = await json(await send(app, 'GET', '/llm-endpoint'));
    expect(data.effective).toMatchObject({ source: 'admin', baseUrl: overrideLlm.url, apiKeyHint: '…wxyz' });
    expect(data.stored).toMatchObject({ baseUrl: overrideLlm.url });

    // Dieselbe Client-Referenz, die auch Chat und /api/models nutzen, folgt der Überschreibung.
    const models = await json(await send(app, 'GET', '/upstream-models'));
    expect(models.models).toEqual(['claude-sonnet-5', 'other']);
    expect(overrideLlm.auth.at(-1)).toBe(`Bearer ${OVERRIDE_KEY}`);
    expect(envLlm.auth).toEqual([]);

    // Der Key liegt nur verschlüsselt in der Datenbank.
    expect(fs.readFileSync(config.memoryDbPath!).includes(OVERRIDE_KEY)).toBe(false);

    expect((await send(app, 'DELETE', '/llm-endpoint')).status).toBe(200);
    expect((await json(await send(app, 'GET', '/llm-endpoint'))).effective.source).toBe('env');
    expect((await json(await send(app, 'GET', '/upstream-models'))).models).toEqual(['env-model']);
  });

  it('keeps the stored key only for the same address', async () => {
    const { app } = createApp(testConfig());
    expect((await send(app, 'PUT', '/llm-endpoint', { baseUrl: overrideLlm.url })).status).toBe(400);
    expect((await send(app, 'PUT', '/llm-endpoint', { baseUrl: overrideLlm.url, apiKey: OVERRIDE_KEY })).status).toBe(200);
    expect((await send(app, 'PUT', '/llm-endpoint', { baseUrl: overrideLlm.url })).status).toBe(200);
    const moved = await send(app, 'PUT', '/llm-endpoint', { baseUrl: 'http://127.0.0.1:9/v1' });
    expect(moved.status).toBe(400);
    expect((await json(moved)).code).toBe('api_key_required');
    expect((await json(await send(app, 'GET', '/llm-endpoint'))).effective.baseUrl).toBe(overrideLlm.url);
  });

  it('refuses to store a key without OVP_SECRET_KEY', async () => {
    vi.stubEnv('OVP_SECRET_KEY', '');
    const { app } = createApp(testConfig());
    const res = await send(app, 'PUT', '/llm-endpoint', { baseUrl: overrideLlm.url, apiKey: OVERRIDE_KEY });
    expect(res.status).toBe(400);
    expect((await json(res)).code).toBe('secret_key_missing');
    expect((await json(await send(app, 'GET', '/llm-endpoint'))).effective.source).toBe('env');
  });

  it('needs a database to override', async () => {
    const { app } = createApp(testConfig({ memoryDbPath: null }));
    expect((await send(app, 'PUT', '/llm-endpoint', { baseUrl: overrideLlm.url, apiKey: OVERRIDE_KEY })).status).toBe(503);
    expect((await json(await send(app, 'GET', '/llm-endpoint'))).canOverride).toBe(false);
  });

  it('does not fall back to env when the stored key cannot be decrypted', async () => {
    const config = testConfig();
    const first = createApp(config);
    expect((await send(first.app, 'PUT', '/llm-endpoint', { baseUrl: overrideLlm.url, apiKey: OVERRIDE_KEY })).status).toBe(200);

    vi.stubEnv('OVP_SECRET_KEY', 'y'.repeat(40));
    const { app } = createApp(config);
    const data = await json(await send(app, 'GET', '/llm-endpoint'));
    expect(data.effective.source).toBe('admin');
    expect(data.effective.blockedReason).toMatch(/OVP_SECRET_KEY/);
    expect((await send(app, 'GET', '/upstream-models')).status).toBe(502);
    expect(envLlm.auth).toEqual([]);
    // Effektiven Endpunkt ohne lesbaren Key nicht testen; Neueingabe des Keys behebt es.
    expect((await send(app, 'POST', '/llm-endpoint/test', {})).status).toBe(400);
    expect((await send(app, 'PUT', '/llm-endpoint', { baseUrl: overrideLlm.url })).status).toBe(400);
    expect((await send(app, 'PUT', '/llm-endpoint', { baseUrl: overrideLlm.url, apiKey: OVERRIDE_KEY })).status).toBe(200);
    expect((await send(app, 'GET', '/upstream-models')).status).toBe(200);
  });
});
