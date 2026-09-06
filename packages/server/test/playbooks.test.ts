import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_SLASH_COMMANDS, type RegisteredDashboard } from '@openvizpilot/shared';
import { createApp } from '../src/app';
import type { AppConfig } from '../src/env';
import { createSqliteMemoryStore, openSqliteDatabase } from '../src/memory/sqlite-store';
import { createLogger } from '../src/logger';

/**
 * Playbooks pro Dashboard: Store, Admin-API und die Auslieferung an die
 * Extension über GET /api/commands?dashboardKey=…
 */

let tmpDirs: string[] = [];
function tmpDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openvizpilot-playbooks-'));
  tmpDirs.push(dir);
  return path.join(dir, 'memory.db');
}
afterEach(() => {
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
  tmpDirs = [];
});

function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    litellmBaseUrl: 'http://127.0.0.1:1',
    litellmApiKey: 'sk-test',
    defaultModel: 'test-model',
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
const PLAYBOOK = {
  starters: ['Wie lief das letzte Quartal?', 'Welche Region ist am profitabelsten?'],
  commands: [
    { name: 'zusammenfassung', description: 'Rentabilitäts-Variante', template: 'Ziel: Rentabilität kompakt zusammenfassen.' },
    { name: 'quartal', description: 'Quartalsvergleich', template: 'Ziel: Quartale vergleichen und Abweichungen nennen.' },
  ],
};

describe('sqlite playbook store', () => {
  it('roundtrips, lists and deletes per dashboard', async () => {
    const store = createSqliteMemoryStore(openSqliteDatabase(tmpDbPath()), createLogger('error'));
    expect(await store.getPlaybook('Rentabilität')).toBeNull();
    await store.setPlaybook('Rentabilität', PLAYBOOK);
    await store.setPlaybook('Umsatz', { starters: ['x'], commands: [] });
    expect(await store.getPlaybook('Rentabilität')).toEqual(PLAYBOOK);
    expect((await store.listPlaybooks()).map((p) => p.dashboardKey)).toEqual(['Rentabilität', 'Umsatz']);
    await store.setPlaybook('Umsatz', null);
    expect(await store.getPlaybook('Umsatz')).toBeNull();
    await store.close();
  });
});

describe('/api/admin/playbooks', () => {
  it('requires auth, validates, and roundtrips PUT → GET → DELETE', async () => {
    const { app } = createApp(testConfig());
    expect((await app.request('/api/admin/playbooks')).status).toBe(401);

    const put = (body: unknown) =>
      app.request('/api/admin/playbooks', {
        method: 'PUT',
        headers: { 'content-type': 'application/json', authorization: 'Bearer geheim' },
        body: JSON.stringify(body),
      });
    expect((await put({ dashboardKey: 'X', playbook: { starters: ['1', '2', '3', '4', '5', '6'], commands: [] } })).status).toBe(400);
    expect((await put({ dashboardKey: 'Rentabilität', playbook: PLAYBOOK })).status).toBe(200);

    const list = (await (await app.request('/api/admin/playbooks', auth)).json()) as { playbooks: unknown };
    expect(list.playbooks).toEqual([{ dashboardKey: 'Rentabilität', playbook: PLAYBOOK }]);

    expect((await app.request('/api/admin/playbooks', { ...auth, method: 'DELETE' })).status).toBe(400);
    expect(
      (await app.request('/api/admin/playbooks?dashboardKey=' + encodeURIComponent('Rentabilität'), { ...auth, method: 'DELETE' })).status,
    ).toBe(200);
    const after = (await (await app.request('/api/admin/playbooks', auth)).json()) as { playbooks: unknown[] };
    expect(after.playbooks).toEqual([]);
  });
});

describe('GET /api/commands with dashboardKey', () => {
  it('returns starters and dashboard commands merged over the global list', async () => {
    const { app } = createApp(testConfig());
    await app.request('/api/admin/playbooks', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', authorization: 'Bearer geheim' },
      body: JSON.stringify({ dashboardKey: 'Rentabilität', playbook: PLAYBOOK }),
    });

    const withKey = (await (await app.request('/api/commands?dashboardKey=' + encodeURIComponent('Rentabilität'))).json()) as {
      commands: Array<{ name: string; description: string }>;
      starters: string[];
    };
    expect(withKey.starters).toEqual(PLAYBOOK.starters);
    expect(withKey.commands[0]).toMatchObject({ name: 'zusammenfassung', description: 'Rentabilitäts-Variante' });
    expect(withKey.commands[1]?.name).toBe('quartal');
    expect(withKey.commands.filter((c) => c.name === 'zusammenfassung')).toHaveLength(1);
    expect(withKey.commands.length).toBe(DEFAULT_SLASH_COMMANDS.length + 1);

    // Anderes Dashboard / ohne Key: globale Liste, keine Starter.
    const other = (await (await app.request('/api/commands?dashboardKey=Umsatz')).json()) as { commands: unknown[]; starters: string[] };
    expect(other.starters).toEqual([]);
    expect(other.commands).toEqual(DEFAULT_SLASH_COMMANDS);
    const none = (await (await app.request('/api/commands')).json()) as { starters: string[] };
    expect(none.starters).toEqual([]);
  });

  it('works without a memory store (defaults, no starters)', async () => {
    const { app } = createApp(testConfig({ memoryDbPath: null, adminToken: null }));
    const data = (await (await app.request('/api/commands?dashboardKey=X')).json()) as { commands: unknown; starters: string[] };
    expect(data.commands).toEqual(DEFAULT_SLASH_COMMANDS);
    expect(data.starters).toEqual([]);
  });
});

const dashboardA = { dashboardKey: 'dashboard:8b1fe8ce-23cb-4a19-9b18-17ed410a0422', name: 'Sales' };
const dashboardB = { dashboardKey: 'dashboard:93b78769-79f3-436b-91e3-a71c998b998a', name: 'Sales' };

describe('registered dashboards and standard analyses', () => {
  it('registers before the first question, separates same-name dashboards and preserves playbooks on refresh', async () => {
    const { app, memoryStore } = createApp(testConfig());
    const register = (body: unknown) => app.request('/api/dashboards', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    expect((await register(dashboardA)).status).toBe(204);
    expect((await register(dashboardB)).status).toBe(204);
    const listed = await (await app.request('/api/admin/playbooks', auth)).json() as { dashboards: RegisteredDashboard[] };
    expect(listed.dashboards).toHaveLength(2);
    expect(listed.dashboards).toEqual(expect.arrayContaining([expect.objectContaining(dashboardA), expect.objectContaining(dashboardB)]));
    expect(await memoryStore!.getDashboardUsage(30)).toEqual([]);
    expect((await app.request('/api/dashboards')).status).toBe(404);
    expect((await app.request('/api/admin/playbooks')).status).toBe(401);

    await app.request('/api/admin/playbooks', {
      method: 'PUT', headers: { ...auth.headers, 'content-type': 'application/json' },
      body: JSON.stringify({ dashboardKey: dashboardA.dashboardKey, playbook: PLAYBOOK }),
    });
    expect((await register({ ...dashboardA, name: 'Sales renamed' })).status).toBe(204);
    const commands = async (key: string) => (await app.request('/api/commands?dashboardKey=' + encodeURIComponent(key))).json() as Promise<{ starters: string[]; commands: unknown[] }>;
    expect((await commands(dashboardA.dashboardKey)).starters).toEqual(PLAYBOOK.starters);
    expect((await commands(dashboardB.dashboardKey)).starters).toEqual([]);
    expect((await commands(dashboardB.dashboardKey)).commands).toEqual(DEFAULT_SLASH_COMMANDS);
    const registered = await memoryStore!.listDashboards();
    expect(registered).toHaveLength(2);
    expect(registered.find((d) => d.dashboardKey === dashboardA.dashboardKey)?.firstSeenAt)
      .toBe(listed.dashboards.find((d: { dashboardKey: string }) => d.dashboardKey === dashboardA.dashboardKey)?.firstSeenAt);
    await app.request('/api/admin/playbooks?dashboardKey=' + encodeURIComponent(dashboardA.dashboardKey), { ...auth, method: 'DELETE' });
    expect((await commands(dashboardA.dashboardKey)).starters).toEqual([]);
    expect(await memoryStore!.listDashboards()).toHaveLength(2);
    await memoryStore!.close();
  });

  it('requires the configured login and validates registrations without permitting admin edits', async () => {
    const { app, memoryStore } = createApp(testConfig({ authMode: 'token', apiAuthToken: 'viewer-token' }));
    const post = (body: unknown, token = '') => app.request('/api/dashboards', {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token }, body: JSON.stringify(body),
    });
    expect((await post(dashboardA)).status).toBe(401);
    expect((await post(dashboardA, 'viewer-token')).status).toBe(204);
    for (const body of [{ ...dashboardA, name: '' }, { ...dashboardA, dashboardKey: 'Sales' }, { ...dashboardA, name: 'a'.repeat(201) }, { ...dashboardA, playbook: PLAYBOOK }]) {
      expect((await post(body, 'viewer-token')).status).toBe(400);
    }
    expect((await app.request('/api/admin/playbooks', { headers: { authorization: 'Bearer viewer-token' } })).status).toBe(401);
    await memoryStore!.close();
  });

  it('returns an explicit unavailable result without a database while global commands remain usable', async () => {
    const { app } = createApp(testConfig({ memoryDbPath: null, adminToken: null }));
    expect((await app.request('/api/dashboards', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(dashboardA) })).status).toBe(503);
    const result = await (await app.request('/api/commands')).json() as { commands: unknown[] };
    expect(result.commands).toEqual(DEFAULT_SLASH_COMMANDS);
  });
});
