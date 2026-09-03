import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_SLASH_COMMANDS } from '@openvizpilot/shared';
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
