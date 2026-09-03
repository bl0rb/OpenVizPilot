import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import type { AppConfig } from '../src/env';
import { createSqliteMemoryStore, openSqliteDatabase } from '../src/memory/sqlite-store';
import { createLogger } from '../src/logger';
import { aggregateDashboardUsage, MIN_USER_COHORT } from '../src/routes/admin';
import { generateUsageSalt, pseudonymizeUser, USAGE_PSEUDONYM_CHARS } from '../src/usage-pseudonym';

/**
 * Dashboard-Nutzung pro Anwender OHNE Namen: Pseudonyme, Store, Zählung in
 * der Chat-Route und Aggregation für die Admin-UI.
 */

let upstream: http.Server;
let upstreamUrl: string;

beforeAll(async () => {
  upstream = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url?.endsWith('/chat/completions')) {
      let raw = '';
      req.on('data', (c: Buffer) => (raw += c.toString()));
      req.on('end', () => {
        const body = JSON.parse(raw) as { stream?: boolean; messages: Array<{ content: string }> };
        if (body.stream !== true) {
          // Scope-Guard-Klassifikation: "Gedicht" ist Off-Topic, alles andere im Scope.
          const offTopic = /gedicht/i.test(body.messages[1]?.content ?? '');
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(
            JSON.stringify({
              choices: [{ index: 0, message: { role: 'assistant', content: offTopic ? 'NEIN' : 'JA' }, finish_reason: 'stop' }],
            }),
          );
          return;
        }
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openvizpilot-usage-'));
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

describe('usage pseudonyms', () => {
  it('are deterministic per salt, salt-dependent and never contain the raw id', () => {
    const salt = generateUsageSalt();
    const a = pseudonymizeUser(salt, 'user-a');
    expect(a).toBe(pseudonymizeUser(salt, 'user-a'));
    expect(a).not.toBe(pseudonymizeUser(salt, 'user-b'));
    expect(a).not.toBe(pseudonymizeUser(generateUsageSalt(), 'user-a'));
    expect(a).toHaveLength(USAGE_PSEUDONYM_CHARS);
    expect(a).not.toContain('user-a');
  });
});

describe('sqlite dashboard usage store', () => {
  it('creates the salt once and aggregates per dashboard/pseudonym across days', async () => {
    const store = createSqliteMemoryStore(openSqliteDatabase(tmpDbPath()), createLogger('error'));
    const salt = await store.getUsageSalt();
    expect(salt).toHaveLength(64);
    expect(await store.getUsageSalt()).toBe(salt);

    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-09-01T12:00:00Z'));
      await store.recordDashboardUsage('Rentabilität', 'p1');
      vi.setSystemTime(new Date('2026-09-02T12:00:00Z'));
      await store.recordDashboardUsage('Rentabilität', 'p1');
      await store.recordDashboardUsage('Rentabilität', 'p2');
      await store.recordDashboardUsage('Rentabilität', '');
      await store.recordDashboardUsage('Umsatz', 'p1');

      const rows = await store.getDashboardUsage(30);
      const find = (d: string, t: string) => rows.find((r) => r.dashboardKey === d && r.userToken === t)?.questions;
      expect(find('Rentabilität', 'p1')).toBe(2);
      expect(find('Rentabilität', 'p2')).toBe(1);
      expect(find('Rentabilität', '')).toBe(1);
      expect(find('Umsatz', 'p1')).toBe(1);
      // Nur heute: der Eintrag von gestern fällt weg.
      expect((await store.getDashboardUsage(1)).find((r) => r.dashboardKey === 'Rentabilität' && r.userToken === 'p1')?.questions).toBe(1);
    } finally {
      vi.useRealTimers();
      await store.close();
    }
  });
});

describe('aggregateDashboardUsage', () => {
  it('counts questions, distinct users, average and max — unknown users count as questions only', () => {
    const out = aggregateDashboardUsage([
      { dashboardKey: 'A', userToken: 'p1', questions: 6 },
      { dashboardKey: 'A', userToken: 'p2', questions: 2 },
      { dashboardKey: 'A', userToken: 'p3', questions: 1 },
      { dashboardKey: 'A', userToken: '', questions: 3 },
      { dashboardKey: 'B', userToken: '', questions: 1 },
    ]);
    expect(out).toEqual([
      { dashboardKey: 'A', questions: 12, users: 3, avgPerUser: 3, maxPerUser: 6 },
      { dashboardKey: 'B', questions: 1, users: null, avgPerUser: null, maxPerUser: null },
    ]);
  });

  it('suppresses per-user figures below the cohort threshold (k-anonymity)', () => {
    expect(MIN_USER_COHORT).toBe(3);
    const out = aggregateDashboardUsage([
      { dashboardKey: 'Vorstand', userToken: 'p1', questions: 7 },
      { dashboardKey: 'Vorstand', userToken: 'p2', questions: 1 },
    ]);
    // Die Fragen-Summe bleibt, die Person-bezogenen Kennzahlen nicht.
    expect(out).toEqual([{ dashboardKey: 'Vorstand', questions: 8, users: null, avgPerUser: null, maxPerUser: null }]);
  });
});

describe('POST /api/chat dashboard usage', () => {
  const chat = (app: ReturnType<typeof createApp>['app'], body: unknown) =>
    app.request('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  const question = (dashboardKey: string, userId?: string, extra: Record<string, unknown> = {}) => ({
    context: '# T',
    dashboardKey,
    userId,
    messages: [{ role: 'user', content: 'Wie läuft es?' }],
    ...extra,
  });

  it('records pseudonymous per-dashboard questions and exposes only counters to admins', async () => {
    const { app } = createApp(testConfig());

    for (const body of [
      question('Rentabilität', 'tableau-user-1'),
      question('Rentabilität', 'tableau-user-1'),
      question('Rentabilität', 'tableau-user-2'),
      question('Rentabilität', 'tableau-user-3'),
      question('Rentabilität'), // ohne User-ID: zählt als Frage, nicht als Anwender
      question('Rentabilität', 'tableau-user-1', { retry: true }), // Retry: zählt NICHT
      question('Umsatz', 'tableau-user-2'),
    ]) {
      const res = await chat(app, body);
      expect(res.status).toBe(200);
      await res.text();
    }

    // Tool-Runden-Fortsetzung (letzte Message = tool) zählt NICHT als Frage.
    const cont = await chat(app, {
      context: '# T',
      dashboardKey: 'Rentabilität',
      userId: 'tableau-user-1',
      messages: [
        { role: 'user', content: 'Welche Filter?' },
        { role: 'assistant', content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'get_filters', arguments: '{}' } }] },
        { role: 'tool', tool_call_id: 'c1', content: 'keine' },
      ],
    });
    expect(cont.status).toBe(200);
    await cont.text();

    await vi.waitFor(async () => {
      const res = await app.request('/api/admin/stats?days=1', { headers: { authorization: 'Bearer geheim' } });
      const data = (await res.json()) as {
        dashboards: Array<{ dashboardKey: string; questions: number; users: number; avgPerUser: number; maxPerUser: number }>;
      };
      expect(data.dashboards).toEqual([
        { dashboardKey: 'Rentabilität', questions: 5, users: 3, avgPerUser: 1.3, maxPerUser: 2 },
        // Nur ein Anwender → Kennzahlen je Anwender unterdrückt.
        { dashboardKey: 'Umsatz', questions: 1, users: null, avgPerUser: null, maxPerUser: null },
      ]);
      // Keine Roh-IDs und keine Pseudonyme in der Admin-Antwort.
      const text = JSON.stringify(data);
      expect(text).not.toContain('tableau-user');
      expect(text).not.toMatch(/[0-9a-f]{32}/);
    });
  });

  it('does not count questions the scope guard refuses', async () => {
    const { app } = createApp(testConfig({ scopeGuardEnabled: true }));
    for (const content of ['Schreib mir ein Gedicht', 'Wie läuft es?']) {
      const res = await chat(app, { ...question('Rentabilität', 'tableau-user-1'), messages: [{ role: 'user', content }] });
      expect(res.status).toBe(200);
      await res.text();
    }
    await vi.waitFor(async () => {
      const res = await app.request('/api/admin/stats?days=1', { headers: { authorization: 'Bearer geheim' } });
      const data = (await res.json()) as { dashboards: Array<{ dashboardKey: string; questions: number }> };
      expect(data.dashboards).toEqual([expect.objectContaining({ dashboardKey: 'Rentabilität', questions: 1 })]);
    });
  });
});
