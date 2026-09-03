import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import type { AppConfig } from '../src/env';

/**
 * Route-Tests für die Admin-API (/api/admin/*, /api/commands, /api/stats)
 * und die Admin-UI (GET /admin) — Gegenstück zu routes/admin.ts,
 * routes/commands.ts, routes/stats.ts, admin-page.ts.
 */

function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    litellmBaseUrl: 'http://127.0.0.1:1', // wird in diesen Tests nie aufgerufen
    litellmApiKey: 'sk-test',
    defaultModel: 'test-model',
    modelAllowlist: null,
    port: 0,
    allowedOrigins: [],
    serveStaticDir: null,
    apiAuthToken: null,
    adminToken: null,
    memoryDatabaseUrl: null,
    memoryDbPath: null,
    memoryModel: 'memory-model',
    scopeGuardEnabled: false,
    scopeModel: 'scope-model',
    logLevel: 'error',
    authMode: 'none',
    publicUrl: null,
    oidc: null,
    licenseEnv: {},
    ...overrides,
  };
}

let tmpDirs: string[] = [];

function tmpDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openvizpilot-admin-route-'));
  tmpDirs.push(dir);
  return path.join(dir, 'memory.db');
}

afterEach(() => {
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
  tmpDirs = [];
});

describe('GET /admin', () => {
  it('404s when no ADMIN_TOKEN is configured', async () => {
    const { app } = createApp(testConfig());
    const res = await app.request('/admin');
    expect(res.status).toBe(404);
  });

  it('serves the admin page HTML when ADMIN_TOKEN is configured', async () => {
    const { app } = createApp(testConfig({ adminToken: 'geheim' }));
    const res = await app.request('/admin');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const body = await res.text();
    expect(body).toContain('Slash-Befehle');
  });
});

describe('/api/admin/*', () => {
  it('404s on every sub-route when neither ADMIN_TOKEN nor a store is configured', async () => {
    const { app } = createApp(testConfig());
    const res = await app.request('/api/admin/commands', { headers: { authorization: 'Bearer irrelevant' } });
    expect(res.status).toBe(404);
  });

  it('401s (password mode active) when a store exists without an ADMIN_TOKEN', async () => {
    const { app } = createApp(testConfig({ memoryDbPath: tmpDbPath() }));
    const res = await app.request('/api/admin/commands', { headers: { authorization: 'Bearer irrelevant' } });
    expect(res.status).toBe(401);
  });

  it('401s with a wrong or missing token', async () => {
    const { app } = createApp(testConfig({ adminToken: 'geheim', memoryDbPath: tmpDbPath() }));
    const noAuth = await app.request('/api/admin/commands');
    expect(noAuth.status).toBe(401);
    const wrongAuth = await app.request('/api/admin/commands', {
      headers: { authorization: 'Bearer falsch' },
    });
    expect(wrongAuth.status).toBe(401);
  });

  it('is exempt from API_AUTH_TOKEN — only the admin token is checked', async () => {
    const { app } = createApp(
      testConfig({ adminToken: 'admin-geheim', apiAuthToken: 'api-geheim', memoryDbPath: tmpDbPath() }),
    );
    // Der API_AUTH_TOKEN allein reicht NICHT für /api/admin/*:
    const withApiToken = await app.request('/api/admin/commands', {
      headers: { authorization: 'Bearer api-geheim' },
    });
    expect(withApiToken.status).toBe(401);
    // Der Admin-Token allein reicht (ohne API_AUTH_TOKEN mitzuschicken):
    const withAdminToken = await app.request('/api/admin/commands', {
      headers: { authorization: 'Bearer admin-geheim' },
    });
    expect(withAdminToken.status).toBe(200);
  });

  it('503s without a configured memory store', async () => {
    const { app } = createApp(testConfig({ adminToken: 'geheim' }));
    const res = await app.request('/api/admin/commands', { headers: { authorization: 'Bearer geheim' } });
    expect(res.status).toBe(503);
  });

  describe('GET/PUT/DELETE /api/admin/commands', () => {
    it('roundtrips: defaults → custom (source "custom") → reset (source "default")', async () => {
      const { app } = createApp(testConfig({ adminToken: 'geheim', memoryDbPath: tmpDbPath() }));
      const auth = { authorization: 'Bearer geheim' };

      const initial = await app.request('/api/admin/commands', { headers: auth });
      expect(initial.status).toBe(200);
      const initialBody = (await initial.json()) as { source: string; commands: unknown[] };
      expect(initialBody.source).toBe('default');
      expect(initialBody.commands.length).toBeGreaterThan(0);

      const custom = [{ name: 'kurz', description: 'Kurze Antwort', template: 'Antworte in maximal zwei Sätzen.' }];
      const put = await app.request('/api/admin/commands', {
        method: 'PUT',
        headers: { ...auth, 'content-type': 'application/json' },
        body: JSON.stringify(custom),
      });
      expect(put.status).toBe(200);

      const afterPut = await app.request('/api/admin/commands', { headers: auth });
      const afterPutBody = (await afterPut.json()) as { source: string; commands: unknown[] };
      expect(afterPutBody.source).toBe('custom');
      expect(afterPutBody.commands).toEqual(custom);

      const del = await app.request('/api/admin/commands', { method: 'DELETE', headers: auth });
      expect(del.status).toBe(200);

      const afterDelete = await app.request('/api/admin/commands', { headers: auth });
      const afterDeleteBody = (await afterDelete.json()) as { source: string };
      expect(afterDeleteBody.source).toBe('default');
    });

    it('rejects a PUT with duplicate command names as 400', async () => {
      const { app } = createApp(testConfig({ adminToken: 'geheim', memoryDbPath: tmpDbPath() }));
      const dupe = { name: 'dup', description: 'x', template: 'x'.repeat(20) };
      const res = await app.request('/api/admin/commands', {
        method: 'PUT',
        headers: { authorization: 'Bearer geheim', 'content-type': 'application/json' },
        body: JSON.stringify([dupe, dupe]),
      });
      expect(res.status).toBe(400);
    });

    it('rejects a PUT with an invalid name as 400', async () => {
      const { app } = createApp(testConfig({ adminToken: 'geheim', memoryDbPath: tmpDbPath() }));
      const res = await app.request('/api/admin/commands', {
        method: 'PUT',
        headers: { authorization: 'Bearer geheim', 'content-type': 'application/json' },
        body: JSON.stringify([{ name: 'Ungültig Name', description: 'x', template: 'x'.repeat(20) }]),
      });
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/admin/stats', () => {
    it('returns aggregated rows for the requested range, clamped to 1..90', async () => {
      const { app } = createApp(testConfig({ adminToken: 'geheim', memoryDbPath: tmpDbPath() }));
      const auth = { authorization: 'Bearer geheim' };
      await app.request('/api/stats', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ events: [{ metric: 'slash_command', key: 'vergleich' }] }),
      });

      const res = await app.request('/api/admin/stats?days=9999', { headers: auth });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { rows: Array<{ metric: string; key: string; count: number }> };
      expect(body.rows).toEqual([expect.objectContaining({ metric: 'slash_command', key: 'vergleich', count: 1 })]);
    });
  });
});

describe('GET /api/commands', () => {
  it('returns the built-in defaults without a memory store', async () => {
    const { app } = createApp(testConfig());
    const res = await app.request('/api/commands');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { commands: unknown[] };
    expect(body.commands.length).toBeGreaterThan(0);
  });

  it('returns admin-configured commands once set', async () => {
    const dbPath = tmpDbPath();
    const admin = createApp(testConfig({ adminToken: 'geheim', memoryDbPath: dbPath }));
    const custom = [{ name: 'kurz', description: 'Kurze Antwort', template: 'Antworte in maximal zwei Sätzen.' }];
    await admin.app.request('/api/admin/commands', {
      method: 'PUT',
      headers: { authorization: 'Bearer geheim', 'content-type': 'application/json' },
      body: JSON.stringify(custom),
    });

    // Öffentliche Route läuft unter API_AUTH_TOKEN, nicht ADMIN_TOKEN — hier keins konfiguriert.
    const { app } = createApp(testConfig({ memoryDbPath: dbPath }));
    const res = await app.request('/api/commands');
    const body = (await res.json()) as { commands: unknown[] };
    expect(body.commands).toEqual(custom);
  });
});

describe('POST /api/stats', () => {
  it('accepts a whitelisted event and returns 204', async () => {
    const { app } = createApp(testConfig({ memoryDbPath: tmpDbPath() }));
    const res = await app.request('/api/stats', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ events: [{ metric: 'action_executed', key: 'apply_filter' }] }),
    });
    expect(res.status).toBe(204);
  });

  it('no-ops with 204 when memory is disabled', async () => {
    const { app } = createApp(testConfig());
    const res = await app.request('/api/stats', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ events: [{ metric: 'action_executed', key: 'apply_filter' }] }),
    });
    expect(res.status).toBe(204);
  });

  it('rejects a metric outside the whitelist with 400', async () => {
    const { app } = createApp(testConfig({ memoryDbPath: tmpDbPath() }));
    const res = await app.request('/api/stats', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ events: [{ metric: 'chat_turn', key: 'test-model' }] }),
    });
    expect(res.status).toBe(400);
  });

  it('never requires or accepts a user-id header (anonymous by design)', async () => {
    const { app } = createApp(testConfig({ memoryDbPath: tmpDbPath() }));
    const res = await app.request('/api/stats', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-tableau-user': 'sollte-ignoriert-werden' },
      body: JSON.stringify({ events: [{ metric: 'standard_question_saved', key: 'saved' }] }),
    });
    expect(res.status).toBe(204);
  });
});

describe('GET /api/admin/trex', () => {
  const auth = { headers: { authorization: 'Bearer geheim' } };

  it('requires the admin token', async () => {
    const { app } = createApp(testConfig({ adminToken: 'geheim' }));
    const res = await app.request('/api/admin/trex?url=https://chat.example.com/');
    expect(res.status).toBe(401);
  });

  it('serves the manifest WITHOUT a memory store (no 503)', async () => {
    const { app } = createApp(testConfig({ adminToken: 'geheim' }));
    const res = await app.request('/api/admin/trex?url=https://chat.example.com/', auth);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/xml');
    expect(res.headers.get('content-disposition')).toContain('openvizpilot.trex');
    const body = await res.text();
    expect(body).toContain('<url>https://chat.example.com/</url>');
    expect(body).toContain('com.openvizpilot.extension');
    expect(body).not.toContain('(Dev)');
  });

  it('normalizes a missing trailing slash', async () => {
    const { app } = createApp(testConfig({ adminToken: 'geheim' }));
    const res = await app.request('/api/admin/trex?url=https://chat.example.com', auth);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<url>https://chat.example.com/</url>');
  });

  it('rejects missing, non-https and query-carrying URLs with 400', async () => {
    const { app } = createApp(testConfig({ adminToken: 'geheim' }));
    for (const query of [
      '',
      '?url=http://chat.example.com/',
      '?url=' + encodeURIComponent('https://chat.example.com/?x=1'),
      '?url=' + encodeURIComponent('https://user:pw@chat.example.com/'),
      '?url=not-a-url',
    ]) {
      const res = await app.request('/api/admin/trex' + query, auth);
      expect(res.status, query).toBe(400);
    }
  });

  it('allows http://localhost for development', async () => {
    const { app } = createApp(testConfig({ adminToken: 'geheim' }));
    const res = await app.request('/api/admin/trex?url=' + encodeURIComponent('http://localhost:3000'), auth);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<url>http://localhost:3000/</url>');
  });
});
