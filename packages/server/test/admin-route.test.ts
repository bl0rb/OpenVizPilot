import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { EE_STUB } from '@openvizpilot/ee/server';
import { createApp } from '../src/app';
import type { AppConfig } from '../src/env';
import { activated, signTestLease, testLicenseEnv } from './license-helper';
import { userAccessId } from '../src/memory/store';

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
    // Tests senden nie nach außen.
    telemetryEndpoint: '',
    appVersion: 'test',
    environment: 'test',
    licenseEnv: {},
    smtpUrl: null,
    smtpFrom: null,
    watchEnabled: true,
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
  it('404s when no OVP_ADMIN_TOKEN is configured', async () => {
    const { app } = createApp(testConfig());
    const res = await app.request('/admin');
    expect(res.status).toBe(404);
  });

  it('serves the admin page HTML when OVP_ADMIN_TOKEN is configured', async () => {
    const { app } = createApp(testConfig({ adminToken: 'geheim' }));
    const res = await app.request('/admin');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const body = await res.text();
    expect(body).toContain('Slash-Befehle');
  });
});

describe('/api/admin/*', () => {
  it('404s on every sub-route when neither OVP_ADMIN_TOKEN nor a store is configured', async () => {
    const { app } = createApp(testConfig());
    const res = await app.request('/api/admin/commands', { headers: { authorization: 'Bearer irrelevant' } });
    expect(res.status).toBe(404);
  });

  it('401s (password mode active) when a store exists without an OVP_ADMIN_TOKEN', async () => {
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

  it('is exempt from OVP_API_AUTH_TOKEN — only the admin token is checked', async () => {
    const { app } = createApp(
      testConfig({ adminToken: 'admin-geheim', apiAuthToken: 'api-geheim', memoryDbPath: tmpDbPath() }),
    );
    // Der OVP_API_AUTH_TOKEN allein reicht NICHT für /api/admin/*:
    const withApiToken = await app.request('/api/admin/commands', {
      headers: { authorization: 'Bearer api-geheim' },
    });
    expect(withApiToken.status).toBe(401);
    // Der Admin-Token allein reicht (ohne OVP_API_AUTH_TOKEN mitzuschicken):
    const withAdminToken = await app.request('/api/admin/commands', {
      headers: { authorization: 'Bearer admin-geheim' },
    });
    expect(withAdminToken.status).toBe(200);
  });

  it('reports the static token as the initial admin', async () => {
    const { app } = createApp(testConfig({ adminToken: 'geheim', memoryDbPath: tmpDbPath() }));
    const res = await app.request('/api/admin/me', { headers: { authorization: 'Bearer geheim' } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ role: 'initial', name: 'Admin-Token', provider: 'token' });
    expect((await app.request('/api/admin/me')).status).toBe(401);
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

    // Öffentliche Route läuft unter OVP_API_AUTH_TOKEN, nicht OVP_ADMIN_TOKEN — hier keins konfiguriert.
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

// Braucht eine echte Lizenz-/Lease-Prüfung (testLicenseEnv(['sso']) + signTestLease)
// — im Core-Export (EE_STUB) ist jede Lizenz 'none', diese Suite läuft nur im vollen Baum.
describe.skipIf(EE_STUB)('licence activation (lease)', () => {
  const auth = { authorization: 'Bearer geheim' };

  it('serves the activation request and accepts a matching offline lease, rejecting foreign ones', async () => {
    const { app } = createApp(testConfig({ adminToken: 'geheim', memoryDbPath: tmpDbPath(), ...testLicenseEnv(['sso']), environment: 'staging' }));

    const before = (await (await app.request('/api/admin/auth-settings', { headers: auth })).json()) as { effective: { license: Record<string, unknown> }; leaseAvailable: boolean };
    expect(before.leaseAvailable).toBe(true);
    // Noch nie eine Lease: pending, Lizenz 'inactive', nur Core.
    expect(before.effective.license).toMatchObject({ status: 'inactive', leaseState: 'pending', environment: 'staging', licensee: 'Test GmbH' });
    expect(typeof before.effective.license.installationId).toBe('string');

    const req = await app.request('/api/admin/license/activation-request', { headers: auth });
    expect(req.status).toBe(200);
    expect(req.headers.get('content-disposition')).toMatch(/ovp-activation-request\.json/);
    const request = (await req.json()) as { installationId: string; requestedAt: string };
    expect(request).toMatchObject({ product: 'openvizpilot', licenseId: 'test-license', environment: 'staging', version: 'test' });
    expect(request.installationId).toBe(before.effective.license.installationId);
    expect(Date.parse(request.requestedAt)).not.toBeNaN();

    const foreign = signTestLease({ installationId: 'someone-else', offline: true });
    const rejected = await app.request('/api/admin/license/lease', { method: 'PUT', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ lease: foreign }) });
    expect(rejected.status).toBe(400);
    expect(((await rejected.json()) as { error: string }).error).toMatch(/anderen Installation/);

    const expired = signTestLease({ installationId: request.installationId, leaseUntil: new Date(Date.now() - 1000).toISOString(), offline: true });
    expect((await app.request('/api/admin/license/lease', { method: 'PUT', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ lease: expired }) })).status).toBe(400);

    const leaseUntil = new Date(Date.now() + 200 * 86_400_000).toISOString();
    const offline = signTestLease({ installationId: request.installationId, leaseUntil, offline: true });
    const accepted = await app.request('/api/admin/license/lease', { method: 'PUT', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ lease: offline }) });
    expect(accepted.status).toBe(200);
    const after = (await accepted.json()) as { effective: { license: Record<string, unknown> } };
    // Erste Aktivierung schaltet die Enterprise-Funktionen frei — ohne Neustart.
    expect(after.effective.license).toMatchObject({ status: 'valid', leaseState: 'active', leaseOffline: true, leaseUntil });
  });

  it('refreshes on demand and needs a database and a valid licence', async () => {
    const instance = createApp(testConfig({ adminToken: 'geheim', memoryDbPath: tmpDbPath(), ...testLicenseEnv(['sso']) }));
    // Ohne Endpunkt (Tests) wird nichts gesendet — die Route antwortet trotzdem mit dem Stand.
    const res = await instance.app.request('/api/admin/license/refresh', { method: 'POST', headers: auth });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { effective: { license: { leaseState: string } } }).effective.license.leaseState).toBe('pending');
    await activated(instance);
    const again = await instance.app.request('/api/admin/license/refresh', { method: 'POST', headers: auth });
    expect(((await again.json()) as { effective: { license: { leaseState: string } } }).effective.license.leaseState).toBe('active');

    const core = createApp(testConfig({ adminToken: 'geheim', memoryDbPath: tmpDbPath() }));
    expect((await core.app.request('/api/admin/license/activation-request', { headers: auth })).status).toBe(400);
    expect((await core.app.request('/api/admin/license/lease', { method: 'PUT', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ lease: 'x.y' }) })).status).toBe(400);

    const noDb = createApp(testConfig({ adminToken: 'geheim', ...testLicenseEnv(['sso']) }));
    expect((await noDb.app.request('/api/admin/license/refresh', { method: 'POST', headers: auth })).status).toBe(503);
    expect((await noDb.app.request('/api/admin/license/activation-request', { headers: auth })).status).toBe(503);
    // Ohne Anmeldung: kein Zugriff auf die Aktivierung.
    expect((await instance.app.request('/api/admin/license/activation-request')).status).toBe(401);
  });
});

describe('stilllegen / übertragen (L3)', () => {
  const auth = { authorization: 'Bearer geheim' };
  const json = { ...auth, 'content-type': 'application/json' };

  /** Legt einen zweiten, delegierten Admin (lokales Konto mit admin: true) neben dem Token-Admin an. */
  async function delegatedAdmin(app: ReturnType<typeof createApp>['app']) {
    await app.request('/api/admin/users', { method: 'POST', headers: json, body: JSON.stringify({ username: 'anna', displayName: 'Anna', password: 'sehr-geheimes-passwort' }) });
    const login = await app.request('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'anna', password: 'sehr-geheimes-passwort' }) });
    const token = ((await login.json()) as { token: string }).token;
    const id = userAccessId({ provider: 'local', issuer: '', subject: 'anna' });
    await app.request(`/api/admin/user-access/${id}`, { method: 'PUT', headers: json, body: JSON.stringify({ ai: false, tableauApi: false, serverData: false, admin: true }) });
    return { authorization: `Bearer ${token}` };
  }

  // Reaktivierung braucht eine echte Lizenz — im Core-Export (EE_STUB) ist jede Lizenz 'none'.
  it.skipIf(EE_STUB)('lets only the initial admin reactivate a deactivated installation', async () => {
    const instance = createApp(testConfig({ adminToken: 'geheim', authMode: 'local', memoryDbPath: tmpDbPath(), ...testLicenseEnv(['sso']) }));
    const delegated = { ...(await delegatedAdmin(instance.app)), 'content-type': 'application/json' };
    await instance.telemetryStore!.recordDeactivation();
    instance.authState.invalidate();

    const refresh = await instance.app.request('/api/admin/license/refresh', { method: 'POST', headers: delegated });
    expect(refresh.status).toBe(403);
    expect(((await refresh.json()) as { code: string }).code).toBe('initial_admin_required');
    const lease = await instance.app.request('/api/admin/license/lease', { method: 'PUT', headers: delegated, body: JSON.stringify({ lease: 'x.y' }) });
    expect(lease.status).toBe(403);

    expect((await instance.app.request('/api/admin/license/refresh', { method: 'POST', headers: json })).status).toBe(200);
  });

  it('rejects deactivate/transfer from a delegated admin but lets any admin read the installation list', async () => {
    const { app } = createApp(testConfig({ adminToken: 'geheim', authMode: 'local', memoryDbPath: tmpDbPath() }));
    const delegated = { ...(await delegatedAdmin(app)), 'content-type': 'application/json' };

    const deactivate = await app.request('/api/admin/license/deactivate', { method: 'POST', headers: delegated, body: JSON.stringify({ confirm: true }) });
    expect(deactivate.status).toBe(403);
    expect(((await deactivate.json()) as { code: string }).code).toBe('initial_admin_required');

    const transfer = await app.request('/api/admin/license/transfer', { method: 'POST', headers: delegated, body: JSON.stringify({ installationId: 'other-installation' }) });
    expect(transfer.status).toBe(403);
    expect(((await transfer.json()) as { code: string }).code).toBe('initial_admin_required');

    // Lesen ist beiden Admin-Rollen erlaubt.
    const list = await app.request('/api/admin/license/installations', { headers: { authorization: delegated.authorization } });
    expect(list.status).toBe(200);
    expect(await list.json()).toEqual({ installations: [] });

    // Der initiale Admin kommt an der Rollenprüfung vorbei (scheitert danach nur am fehlenden Endpunkt der Testumgebung).
    const initialDeactivate = await app.request('/api/admin/license/deactivate', { method: 'POST', headers: json, body: JSON.stringify({ confirm: true }) });
    expect(initialDeactivate.status).not.toBe(403);
    const initialTransfer = await app.request('/api/admin/license/transfer', { method: 'POST', headers: json, body: JSON.stringify({ installationId: 'other-installation' }) });
    expect(initialTransfer.status).not.toBe(403);
  });

  it('requires an explicit confirmation flag and a non-empty installation id', async () => {
    const { app } = createApp(testConfig({ adminToken: 'geheim', memoryDbPath: tmpDbPath() }));
    for (const body of [{}, { confirm: false }, { confirm: 'true' }]) {
      const res = await app.request('/api/admin/license/deactivate', { method: 'POST', headers: json, body: JSON.stringify(body) });
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    for (const body of [{}, { installationId: '' }]) {
      const res = await app.request('/api/admin/license/transfer', { method: 'POST', headers: json, body: JSON.stringify(body) });
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    // Ohne Anmeldung: kein Zugriff.
    expect((await app.request('/api/admin/license/deactivate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirm: true }) })).status).toBe(401);
  });

  it('needs a database for all three routes', async () => {
    const { app } = createApp(testConfig({ adminToken: 'geheim' }));
    expect((await app.request('/api/admin/license/deactivate', { method: 'POST', headers: json, body: JSON.stringify({ confirm: true }) })).status).toBe(503);
    expect((await app.request('/api/admin/license/transfer', { method: 'POST', headers: json, body: JSON.stringify({ installationId: 'x' }) })).status).toBe(503);
    expect((await app.request('/api/admin/license/installations', { headers: auth })).status).toBe(503);
  });
});

describe('PUT /api/admin/user-access/:id — Serverdaten (W5)', () => {
  const auth = { authorization: 'Bearer geheim' };
  const json = { ...auth, 'content-type': 'application/json' };

  it('lets every admin set serverData and clears a stored consent when it is revoked', async () => {
    const instance = createApp(testConfig({ adminToken: 'geheim', authMode: 'local', memoryDbPath: tmpDbPath() }));
    const { app, memoryStore } = instance;
    await app.request('/api/admin/users', { method: 'POST', headers: json, body: JSON.stringify({ username: 'anna', displayName: 'Anna', password: 'sehr-geheimes-passwort' }) });
    const id = userAccessId({ provider: 'local', issuer: '', subject: 'anna' });

    expect((await app.request(`/api/admin/user-access/${id}`, { method: 'PUT', headers: json, body: JSON.stringify({ ai: false, tableauApi: false, serverData: true }) })).status).toBe(200);
    expect((await memoryStore!.getUserAccess(id))?.serverData).toBe(true);
    await memoryStore!.setServerDataConsent(id, new Date());
    expect(await memoryStore!.getServerDataConsent(id)).not.toBeNull();

    // Widerruf: Freigabe abschalten löscht zusätzlich die bereits erteilte Einwilligung.
    expect((await app.request(`/api/admin/user-access/${id}`, { method: 'PUT', headers: json, body: JSON.stringify({ ai: false, tableauApi: false, serverData: false }) })).status).toBe(200);
    expect((await memoryStore!.getUserAccess(id))?.serverData).toBe(false);
    expect(await memoryStore!.getServerDataConsent(id)).toBeNull();
  });
});
