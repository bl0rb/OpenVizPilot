import type { SlashCommand } from '@openvizpilot/shared';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLogger } from '../src/logger';
import { createPgMemoryStore, type PgPoolLike } from '../src/memory/pg-store';
import { createSqliteMemoryStore, openSqliteDatabase } from '../src/memory/sqlite-store';

const logger = createLogger('error');

describe('sqlite memory store', () => {
  let tmpDir: string | null = null;

  afterEach(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = null;
  });

  function makeStore() {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openvizpilot-mem-'));
    const store = createSqliteMemoryStore(openSqliteDatabase(path.join(tmpDir, 'memory.db')), logger);
    if (!store) throw new Error('node:sqlite nicht verfügbar');
    return store;
  }

  it('has no slash commands configured until an admin sets them, and resets on null', async () => {
    const store = makeStore();
    expect(await store.getSlashCommands()).toBeNull();

    const commands: SlashCommand[] = [
      { name: 'kurz', description: 'Kurze Antwort', template: 'Antworte in maximal zwei Sätzen.' },
    ];
    await store.setSlashCommands(commands);
    expect(await store.getSlashCommands()).toEqual(commands);

    // Zweiter Write ersetzt den ersten komplett (Singleton-Zeile):
    const replacement: SlashCommand[] = [
      { name: 'lang', description: 'Ausführliche Antwort', template: 'Antworte ausführlich mit Belegen.' },
    ];
    await store.setSlashCommands(replacement);
    expect(await store.getSlashCommands()).toEqual(replacement);

    // null setzt zurück auf "nie konfiguriert" (Defaults gelten beim Aufrufer):
    await store.setSlashCommands(null);
    expect(await store.getSlashCommands()).toBeNull();
    await store.close();
  });

  it('aggregates recordUsage calls for the same (metric, key) into one counter', async () => {
    const store = makeStore();
    await store.recordUsage([{ metric: 'slash_command', key: 'vergleich' }]);
    await store.recordUsage([{ metric: 'slash_command', key: 'vergleich' }]);

    const rows = await store.getUsageStats(30);
    expect(rows).toEqual([
      expect.objectContaining({ metric: 'slash_command', key: 'vergleich', count: 2 }),
    ]);
    await store.close();
  });

  it('keeps different keys of one recordUsage batch as separate counters', async () => {
    const store = makeStore();
    await store.recordUsage([
      { metric: 'tool_call', key: 'get_filters' },
      { metric: 'tool_call', key: 'get_filters' },
      { metric: 'tool_call', key: 'get_parameters' },
    ]);

    const rows = await store.getUsageStats(30);
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r.count]));
    expect(byKey.get_filters).toBe(2);
    expect(byKey.get_parameters).toBe(1);
    await store.close();
  });

  it('getUsageStats only returns days within the requested range', async () => {
    const store = makeStore();
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-01-01T12:00:00Z'));
      await store.recordUsage([{ metric: 'chat_turn', key: 'alt' }]);
      vi.setSystemTime(new Date('2026-01-10T12:00:00Z'));
      await store.recordUsage([{ metric: 'chat_turn', key: 'neu' }]);

      const wide = await store.getUsageStats(90);
      expect(wide.map((r) => r.key).sort()).toEqual(['alt', 'neu']);

      const narrow = await store.getUsageStats(1);
      expect(narrow.map((r) => r.key)).toEqual(['neu']);
    } finally {
      vi.useRealTimers();
      await store.close();
    }
  });
});

describe('pg memory store (stubbed pool)', () => {
  function makeStubPool() {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const rows: Record<string, string[]> = {};
    const epochs: Record<string, number> = {};
    const prefsRows: Record<string, string> = {};
    let slashCommandsRow: string | null = null;
    const usageCounts: Record<string, number> = {};
    let usageSalt: string | null = null;
    const dashboardCounts: Record<string, number> = {};
    const playbooks: Record<string, string> = {};
    const exec = async (text: string, values?: unknown[]) => {
      queries.push({ text: text.trim(), values });
      const userId = values?.[0] as string;
      if (text.includes('INSERT INTO user_memory_state')) {
        epochs[userId] ??= 0;
        return { rows: [], rowCount: 1 };
      }
      if (text.includes('SELECT epoch')) {
        // deckt sowohl FOR UPDATE (in Transaktion) als auch Plain-Select ab
        return {
          rows: userId in epochs ? [{ epoch: String(epochs[userId]) }] : [],
          rowCount: null,
        };
      }
      if (text.includes('UPDATE user_memory_state SET epoch')) {
        epochs[userId] = (epochs[userId] ?? 0) + 1;
        return { rows: [], rowCount: 1 };
      }
      if (text.includes('SELECT fact')) {
        return { rows: (rows[userId] ?? []).map((fact) => ({ fact })), rowCount: null };
      }
      if (text.includes('DELETE FROM user_facts')) {
        const count = rows[userId]?.length ?? 0;
        delete rows[userId];
        return { rows: [], rowCount: count };
      }
      if (text.includes('INSERT INTO user_facts')) {
        const [u, fact] = values as [string, string];
        (rows[u] ??= []).push(fact);
      }
      if (text.includes('SELECT prefs FROM user_dashboard_prefs')) {
        const [u, dashboardKey] = values as [string, string];
        const prefs = prefsRows[`${u}::${dashboardKey}`];
        return { rows: prefs !== undefined ? [{ prefs }] : [], rowCount: null };
      }
      if (text.includes('INSERT INTO user_dashboard_prefs')) {
        // deckt die ON CONFLICT ... DO UPDATE-Upsert-Semantik ab
        const [u, dashboardKey, prefsJson] = values as [string, string, string];
        prefsRows[`${u}::${dashboardKey}`] = prefsJson;
        return { rows: [], rowCount: 1 };
      }
      if (text.includes('SELECT commands FROM admin_slash_commands')) {
        return { rows: slashCommandsRow !== null ? [{ commands: slashCommandsRow }] : [], rowCount: null };
      }
      if (text.includes('DELETE FROM admin_slash_commands')) {
        slashCommandsRow = null;
        return { rows: [], rowCount: 1 };
      }
      if (text.includes('INSERT INTO admin_slash_commands')) {
        // deckt die ON CONFLICT (id) DO UPDATE-Upsert-Semantik der Singleton-Zeile ab
        slashCommandsRow = values?.[0] as string;
        return { rows: [], rowCount: 1 };
      }
      if (text.includes('INSERT INTO usage_stats')) {
        // deckt die ON CONFLICT (day,metric,key) DO UPDATE SET count = ... + EXCLUDED.count-Aggregation ab
        const [day, metric, key] = values as [string, string, string];
        const k = `${day}::${metric}::${key}`;
        usageCounts[k] = (usageCounts[k] ?? 0) + 1;
        return { rows: [], rowCount: 1 };
      }
      if (text.includes('SELECT playbook FROM admin_playbooks')) {
        const key = values?.[0] as string;
        return { rows: key in playbooks ? [{ playbook: playbooks[key] }] : [], rowCount: null };
      }
      if (text.includes('SELECT dashboard_key, playbook FROM admin_playbooks')) {
        return {
          rows: Object.keys(playbooks).sort().map((k) => ({ dashboard_key: k, playbook: playbooks[k] })),
          rowCount: null,
        };
      }
      if (text.includes('DELETE FROM admin_playbooks')) {
        delete playbooks[values?.[0] as string];
        return { rows: [], rowCount: 1 };
      }
      if (text.includes('INSERT INTO admin_playbooks')) {
        // ON CONFLICT (dashboard_key) DO UPDATE — Upsert je Dashboard
        const [key, json] = values as [string, string];
        playbooks[key] = json;
        return { rows: [], rowCount: 1 };
      }
      if (text.includes('INSERT INTO usage_salt')) {
        // ON CONFLICT (id) DO NOTHING: der erste Salt gewinnt, weitere Inserts sind No-ops
        if (usageSalt === null) {
          usageSalt = values?.[0] as string;
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }
      if (text.includes('SELECT salt FROM usage_salt')) {
        return { rows: usageSalt !== null ? [{ salt: usageSalt }] : [], rowCount: null };
      }
      if (text.includes('INSERT INTO usage_dashboards')) {
        // ON CONFLICT (day, dashboard_key, user_token) DO UPDATE ... + EXCLUDED.count
        const [day, dashboardKey, token] = values as [string, string, string];
        const k = `${day}::${dashboardKey}::${token}`;
        dashboardCounts[k] = (dashboardCounts[k] ?? 0) + 1;
        return { rows: [], rowCount: 1 };
      }
      if (text.includes('SELECT dashboard_key, user_token, SUM(count)')) {
        const cutoff = values?.[0] as string;
        const grouped: Record<string, number> = {};
        for (const [k, count] of Object.entries(dashboardCounts)) {
          const [day, dashboardKey, token] = k.split('::') as [string, string, string];
          if (day < cutoff) continue;
          grouped[`${dashboardKey}::${token}`] = (grouped[`${dashboardKey}::${token}`] ?? 0) + count;
        }
        // pg liefert SUM(BIGINT) als String — der Store muss das nach Number wandeln.
        return {
          rows: Object.entries(grouped).map(([k, questions]) => {
            const [dashboard_key, user_token] = k.split('::');
            return { dashboard_key, user_token, questions: String(questions) };
          }),
          rowCount: null,
        };
      }
      if (text.includes('SELECT day, metric, key, count FROM usage_stats')) {
        const cutoff = values?.[0] as string;
        const matched = Object.entries(usageCounts)
          .filter(([k]) => (k.split('::')[0] ?? '') >= cutoff)
          .map(([k, count]) => {
            const [day, metric, key] = k.split('::');
            return { day, metric, key, count: String(count) };
          });
        return { rows: matched, rowCount: null };
      }
      return { rows: [], rowCount: 0 };
    };
    const pool: PgPoolLike = {
      query: exec,
      connect: async () => ({ query: exec, release: () => undefined }),
      end: async () => undefined,
    };
    return { pool, queries, rows, epochs };
  }

  it('upserts, lists and deletes dashboard playbooks (pg)', async () => {
    const { pool, queries } = makeStubPool();
    const store = createPgMemoryStore(pool, logger);
    const playbook = { starters: ['Wie lief Q3?'], commands: [{ name: 'q', description: 'd', template: 'Ziel: Quartal vergleichen.' }] };
    expect(await store.getPlaybook('Rentabilität')).toBeNull();
    await store.setPlaybook('Rentabilität', playbook);
    await store.setPlaybook('Rentabilität', { ...playbook, starters: ['Neu'] }); // Upsert
    expect((await store.getPlaybook('Rentabilität'))?.starters).toEqual(['Neu']);
    expect((await store.listPlaybooks()).map((p) => p.dashboardKey)).toEqual(['Rentabilität']);
    expect(queries.some((q) => q.text.includes('INSERT INTO admin_playbooks') && q.text.includes('ON CONFLICT (dashboard_key)'))).toBe(true);
    await store.setPlaybook('Rentabilität', null);
    expect(await store.getPlaybook('Rentabilität')).toBeNull();
    expect(await store.listPlaybooks()).toEqual([]);
  });

  it('creates the usage salt once and aggregates dashboard usage per pseudonym (pg)', async () => {
    const { pool, queries } = makeStubPool();
    const store = createPgMemoryStore(pool, logger);
    const salt = await store.getUsageSalt();
    expect(salt).toHaveLength(64);
    expect(await store.getUsageSalt()).toBe(salt);
    expect(queries.some((q) => q.text.includes('INSERT INTO usage_salt') && q.text.includes('DO NOTHING'))).toBe(true);

    await store.recordDashboardUsage('Rentabilität', 'p1');
    await store.recordDashboardUsage('Rentabilität', 'p1');
    await store.recordDashboardUsage('Rentabilität', '');
    const rows = await store.getDashboardUsage(30);
    expect(rows).toEqual(
      expect.arrayContaining([
        { dashboardKey: 'Rentabilität', userToken: 'p1', questions: 2 },
        { dashboardKey: 'Rentabilität', userToken: '', questions: 1 },
      ]),
    );
    // Zahlen kommen als Number an, nicht als pg-String:
    expect(typeof rows[0]?.questions).toBe('number');
  });

  it('stores, reads, and resets slash commands (singleton row upsert)', async () => {
    const { pool, queries } = makeStubPool();
    const store = createPgMemoryStore(pool, logger);
    expect(await store.getSlashCommands()).toBeNull();

    const commands: SlashCommand[] = [
      { name: 'kurz', description: 'Kurze Antwort', template: 'Antworte in maximal zwei Sätzen.' },
    ];
    await store.setSlashCommands(commands);
    expect(await store.getSlashCommands()).toEqual(commands);

    await store.setSlashCommands(null);
    expect(await store.getSlashCommands()).toBeNull();

    const texts = queries.map((q) => q.text);
    expect(texts.some((t) => t.includes('ON CONFLICT (id) DO UPDATE'))).toBe(true);
    expect(texts.some((t) => t.includes('DELETE FROM admin_slash_commands'))).toBe(true);
  });

  it('aggregates usage events via ON CONFLICT upsert and reads them back', async () => {
    const { pool, queries } = makeStubPool();
    const store = createPgMemoryStore(pool, logger);
    await store.recordUsage([{ metric: 'slash_command', key: 'vergleich' }]);
    await store.recordUsage([{ metric: 'slash_command', key: 'vergleich' }]);

    const rows = await store.getUsageStats(30);
    expect(rows).toEqual([
      expect.objectContaining({ metric: 'slash_command', key: 'vergleich', count: 2 }),
    ]);

    const texts = queries.map((q) => q.text);
    expect(texts.some((t) => t.includes('ON CONFLICT (day, metric, key)'))).toBe(true);
  });
});
