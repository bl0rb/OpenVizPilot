import {
  authSettingsSchema,
  type AuthSettings,
  dashboardPlaybookSchema,
  modelCatalogSchema,
  slashCommandListSchema,
  type DashboardPlaybook,
  type ModelOption,
  type SlashCommand,
} from '@openvizpilot/shared';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { Logger } from '../logger';
import { generateUsageSalt } from '../usage-pseudonym';
import type { LocalUser, LocalUserAuth, MemoryStore } from './store';

/**
 * SQLite-Backend über das Node-Builtin `node:sqlite` — für die lokale
 * Entwicklung ohne Postgres. Keine native npm-Dependency (Node ≥ 24).
 *
 * Bewusst via createRequire statt statischem Import geladen: esbuild/tsup
 * schreibt den statischen Import beim Bündeln zu einem unauflösbaren Paket
 * "sqlite" um (node:-Präfix wird gestrippt) — der dynamische require bleibt
 * im Bundle unangetastet.
 */
interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): {
    all(...params: unknown[]): unknown[];
    run(...params: unknown[]): { changes: number | bigint };
  };
  close(): void;
}

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: new (path: string) => SqliteDatabase;
};

/** Ungültig gespeicherte Playbooks (altes Schema) gelten als "nicht vorhanden". */
function parsePlaybook(raw: string): DashboardPlaybook | null {
  try {
    const parsed = dashboardPlaybookSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Öffnet die Datei und legt das Verzeichnis an — Handle wird geteilt (siehe store.ts). */
export function openSqliteDatabase(dbPath: string): SqliteDatabase {
  fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
  return new DatabaseSync(dbPath);
}

export function createSqliteMemoryStore(db: SqliteDatabase, logger: Logger): MemoryStore {
  db.exec(`
    CREATE TABLE IF NOT EXISTS admin_slash_commands (
      id INTEGER PRIMARY KEY,
      commands TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS admin_playbooks (
      dashboard_key TEXT PRIMARY KEY,
      playbook TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS admin_models (
      id INTEGER PRIMARY KEY,
      catalog TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS usage_stats (
      day TEXT NOT NULL,
      metric TEXT NOT NULL,
      key TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (day, metric, key)
    );
    CREATE TABLE IF NOT EXISTS usage_salt (
      id INTEGER PRIMARY KEY,
      salt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS usage_dashboards (
      day TEXT NOT NULL,
      dashboard_key TEXT NOT NULL,
      user_token TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (day, dashboard_key, user_token)
    );
    CREATE TABLE IF NOT EXISTS admin_account (
      id INTEGER PRIMARY KEY,
      password_hash TEXT NOT NULL,
      failed_count INTEGER NOT NULL DEFAULT 0,
      last_failed_at INTEGER,
      locked_until INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS admin_sessions (
      token_hash TEXT PRIMARY KEY,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS users (
      username TEXT PRIMARY KEY,
      display_name TEXT NOT NULL DEFAULT '',
      password_hash TEXT NOT NULL,
      failed_count INTEGER NOT NULL DEFAULT 0,
      last_failed_at INTEGER,
      locked_until INTEGER,
      disabled INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS user_sessions (
      token_hash TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(username);
    CREATE TABLE IF NOT EXISTS admin_settings (
      id INTEGER PRIMARY KEY,
      settings TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  logger.debug('sqlite memory store geöffnet');

  return {
    async getSlashCommands(): Promise<SlashCommand[] | null> {
      const rows = db
        .prepare('SELECT commands FROM admin_slash_commands WHERE id = 1')
        .all() as Array<{ commands: string }>;
      const row = rows[0];
      if (!row) return null;
      try {
        const parsed = slashCommandListSchema.safeParse(JSON.parse(row.commands));
        // Ungültig (z. B. altes Schema): wie "nie konfiguriert" behandeln.
        return parsed.success ? parsed.data : null;
      } catch {
        return null;
      }
    },

    async setSlashCommands(commands: SlashCommand[] | null): Promise<void> {
      if (commands === null) {
        db.prepare('DELETE FROM admin_slash_commands WHERE id = 1').run();
        return;
      }
      db.prepare(
        `INSERT INTO admin_slash_commands (id, commands, updated_at)
         VALUES (1, ?, datetime('now'))
         ON CONFLICT(id) DO UPDATE SET commands = excluded.commands, updated_at = excluded.updated_at`,
      ).run(JSON.stringify(commands));
    },

    async getModelCatalog(): Promise<ModelOption[] | null> {
      const rows = db.prepare('SELECT catalog FROM admin_models WHERE id = 1').all() as Array<{ catalog: string }>;
      const row = rows[0];
      if (!row) return null;
      try {
        const parsed = modelCatalogSchema.safeParse(JSON.parse(row.catalog));
        // Ungültig (z. B. altes Schema): wie "nie konfiguriert" behandeln.
        return parsed.success ? parsed.data : null;
      } catch {
        return null;
      }
    },

    async setModelCatalog(catalog: ModelOption[] | null): Promise<void> {
      if (catalog === null) {
        db.prepare('DELETE FROM admin_models WHERE id = 1').run();
        return;
      }
      db.prepare(
        `INSERT INTO admin_models (id, catalog, updated_at)
         VALUES (1, ?, datetime('now'))
         ON CONFLICT(id) DO UPDATE SET catalog = excluded.catalog, updated_at = excluded.updated_at`,
      ).run(JSON.stringify(catalog));
    },

    async getPlaybook(dashboardKey: string): Promise<DashboardPlaybook | null> {
      const rows = db
        .prepare('SELECT playbook FROM admin_playbooks WHERE dashboard_key = ?')
        .all(dashboardKey) as Array<{ playbook: string }>;
      return rows[0] ? parsePlaybook(rows[0].playbook) : null;
    },

    async setPlaybook(dashboardKey: string, playbook: DashboardPlaybook | null): Promise<void> {
      if (playbook === null) {
        db.prepare('DELETE FROM admin_playbooks WHERE dashboard_key = ?').run(dashboardKey);
        return;
      }
      db.prepare(
        `INSERT INTO admin_playbooks (dashboard_key, playbook, updated_at)
         VALUES (?, ?, datetime('now'))
         ON CONFLICT(dashboard_key) DO UPDATE SET playbook = excluded.playbook, updated_at = excluded.updated_at`,
      ).run(dashboardKey, JSON.stringify(playbook));
    },

    async listPlaybooks() {
      const rows = db
        .prepare('SELECT dashboard_key, playbook FROM admin_playbooks ORDER BY dashboard_key')
        .all() as Array<{ dashboard_key: string; playbook: string }>;
      return rows.flatMap((r) => {
        const playbook = parsePlaybook(r.playbook);
        return playbook ? [{ dashboardKey: r.dashboard_key, playbook }] : [];
      });
    },

    async recordUsage(events: Array<{ metric: string; key: string }>): Promise<void> {
      if (events.length === 0) return;
      // EIN Tag für den ganzen Batch — die Events eines Requests treffen
      // praktisch gleichzeitig ein.
      const day = new Date().toISOString().slice(0, 10);
      for (const { metric, key } of events) {
        db.prepare(
          `INSERT INTO usage_stats (day, metric, key, count)
           VALUES (?, ?, ?, 1)
           ON CONFLICT(day, metric, key) DO UPDATE SET count = count + excluded.count`,
        ).run(day, metric, key);
      }
    },

    async getUsageStats(
      days: number,
    ): Promise<Array<{ day: string; metric: string; key: string; count: number }>> {
      const cutoff = new Date(Date.now() - (Math.max(1, days) - 1) * 86_400_000).toISOString().slice(0, 10);
      const rows = db
        .prepare('SELECT day, metric, key, count FROM usage_stats WHERE day >= ? ORDER BY day DESC, metric, key')
        .all(cutoff) as Array<{ day: string; metric: string; key: string; count: number | bigint }>;
      return rows.map((r) => ({ day: r.day, metric: r.metric, key: r.key, count: Number(r.count) }));
    },

    async getUsageSalt(): Promise<string> {
      db.prepare('INSERT INTO usage_salt (id, salt) VALUES (1, ?) ON CONFLICT(id) DO NOTHING').run(
        generateUsageSalt(),
      );
      const rows = db.prepare('SELECT salt FROM usage_salt WHERE id = 1').all() as Array<{ salt: string }>;
      return rows[0]!.salt;
    },

    async recordDashboardUsage(dashboardKey: string, userToken: string): Promise<void> {
      const day = new Date().toISOString().slice(0, 10);
      db.prepare(
        `INSERT INTO usage_dashboards (day, dashboard_key, user_token, count)
         VALUES (?, ?, ?, 1)
         ON CONFLICT(day, dashboard_key, user_token) DO UPDATE SET count = count + excluded.count`,
      ).run(day, dashboardKey, userToken);
    },

    async getDashboardUsage(days: number) {
      const cutoff = new Date(Date.now() - (Math.max(1, days) - 1) * 86_400_000).toISOString().slice(0, 10);
      const rows = db
        .prepare(
          `SELECT dashboard_key, user_token, SUM(count) AS questions
           FROM usage_dashboards WHERE day >= ?
           GROUP BY dashboard_key, user_token`,
        )
        .all(cutoff) as Array<{ dashboard_key: string; user_token: string; questions: number | bigint }>;
      return rows.map((r) => ({ dashboardKey: r.dashboard_key, userToken: r.user_token, questions: Number(r.questions) }));
    },

    async getAdminAccount() {
      const rows = db
        .prepare('SELECT password_hash, failed_count, last_failed_at, locked_until FROM admin_account WHERE id = 1')
        .all() as Array<{
        password_hash: string;
        failed_count: number | bigint;
        last_failed_at: number | bigint | null;
        locked_until: number | bigint | null;
      }>;
      const row = rows[0];
      if (!row) return null;
      return {
        passwordHash: row.password_hash,
        failedCount: Number(row.failed_count),
        lastFailedAt: row.last_failed_at === null ? null : Number(row.last_failed_at),
        lockedUntil: row.locked_until === null ? null : Number(row.locked_until),
      };
    },

    async createAdminAccount(passwordHash: string): Promise<boolean> {
      const result = db
        .prepare('INSERT INTO admin_account (id, password_hash) VALUES (1, ?) ON CONFLICT(id) DO NOTHING')
        .run(passwordHash);
      return Number(result.changes) === 1;
    },

    async registerFailedAdminLogin(nowMs: number, windowMs: number): Promise<number> {
      // Atomar in EINEM Statement zählen (siehe store.ts-Interface): ein
      // abgelaufenes Fehlversuchs-Fenster startet den Zähler bei 1.
      const rows = db
        .prepare(
          `UPDATE admin_account
           SET failed_count = CASE WHEN last_failed_at IS NULL OR ? - last_failed_at > ? THEN 1 ELSE failed_count + 1 END,
               last_failed_at = ?
           WHERE id = 1
           RETURNING failed_count`,
        )
        .all(nowMs, windowMs, nowMs) as Array<{ failed_count: number | bigint }>;
      return rows[0] ? Number(rows[0].failed_count) : 0;
    },

    async lockAdminAccount(untilMs: number): Promise<void> {
      db.prepare('UPDATE admin_account SET locked_until = ?, failed_count = 0 WHERE id = 1').run(untilMs);
    },

    async resetAdminLoginFailures(): Promise<void> {
      db.prepare(
        'UPDATE admin_account SET failed_count = 0, last_failed_at = NULL, locked_until = NULL WHERE id = 1',
      ).run();
    },

    async createAdminSession(tokenHash: string, expiresAtMs: number): Promise<void> {
      db.prepare('INSERT INTO admin_sessions (token_hash, expires_at) VALUES (?, ?)').run(
        tokenHash,
        expiresAtMs,
      );
    },

    async hasAdminSession(tokenHash: string, nowMs: number): Promise<boolean> {
      db.prepare('DELETE FROM admin_sessions WHERE expires_at < ?').run(nowMs);
      const rows = db
        .prepare('SELECT 1 AS ok FROM admin_sessions WHERE token_hash = ? AND expires_at >= ?')
        .all(tokenHash, nowMs);
      return rows.length > 0;
    },

    async deleteAdminSession(tokenHash: string): Promise<void> {
      db.prepare('DELETE FROM admin_sessions WHERE token_hash = ?').run(tokenHash);
    },

    async listUsers(): Promise<LocalUser[]> {
      const rows = db
        .prepare('SELECT username, display_name, disabled, created_at FROM users ORDER BY username')
        .all() as Array<{ username: string; display_name: string; disabled: number | bigint; created_at: string }>;
      return rows.map((r) => ({ username: r.username, displayName: r.display_name, disabled: Number(r.disabled) === 1, createdAt: r.created_at }));
    },

    async getUserAuth(username: string): Promise<LocalUserAuth | null> {
      const rows = db
        .prepare('SELECT username, display_name, password_hash, failed_count, last_failed_at, locked_until, disabled, created_at FROM users WHERE username = ?')
        .all(username) as Array<{
        username: string;
        display_name: string;
        password_hash: string;
        failed_count: number | bigint;
        last_failed_at: number | bigint | null;
        locked_until: number | bigint | null;
        disabled: number | bigint;
        created_at: string;
      }>;
      const r = rows[0];
      if (!r) return null;
      return {
        username: r.username,
        displayName: r.display_name,
        passwordHash: r.password_hash,
        failedCount: Number(r.failed_count),
        lastFailedAt: r.last_failed_at === null ? null : Number(r.last_failed_at),
        lockedUntil: r.locked_until === null ? null : Number(r.locked_until),
        disabled: Number(r.disabled) === 1,
        createdAt: r.created_at,
      };
    },

    async createUser(username: string, displayName: string, passwordHash: string): Promise<boolean> {
      const result = db
        .prepare('INSERT INTO users (username, display_name, password_hash) VALUES (?, ?, ?) ON CONFLICT(username) DO NOTHING')
        .run(username, displayName, passwordHash);
      return Number(result.changes) === 1;
    },

    async setUserPassword(username: string, passwordHash: string): Promise<boolean> {
      return Number(db.prepare('UPDATE users SET password_hash = ? WHERE username = ?').run(passwordHash, username).changes) === 1;
    },

    async setUserDisabled(username: string, disabled: boolean): Promise<boolean> {
      return Number(db.prepare('UPDATE users SET disabled = ? WHERE username = ?').run(disabled ? 1 : 0, username).changes) === 1;
    },

    async deleteUser(username: string): Promise<boolean> {
      db.prepare('DELETE FROM user_sessions WHERE username = ?').run(username);
      return Number(db.prepare('DELETE FROM users WHERE username = ?').run(username).changes) === 1;
    },

    async registerFailedUserLogin(username: string, nowMs: number, windowMs: number): Promise<number> {
      const rows = db
        .prepare(
          `UPDATE users
           SET failed_count = CASE WHEN last_failed_at IS NULL OR ? - last_failed_at > ? THEN 1 ELSE failed_count + 1 END,
               last_failed_at = ?
           WHERE username = ?
           RETURNING failed_count`,
        )
        .all(nowMs, windowMs, nowMs, username) as Array<{ failed_count: number | bigint }>;
      return rows[0] ? Number(rows[0].failed_count) : 0;
    },

    async lockUser(username: string, untilMs: number): Promise<void> {
      db.prepare('UPDATE users SET locked_until = ?, failed_count = 0 WHERE username = ?').run(untilMs, username);
    },

    async resetUserLoginFailures(username: string): Promise<void> {
      db.prepare('UPDATE users SET failed_count = 0, last_failed_at = NULL, locked_until = NULL WHERE username = ?').run(username);
    },

    async createUserSession(tokenHash: string, username: string, expiresAtMs: number): Promise<void> {
      db.prepare('INSERT INTO user_sessions (token_hash, username, expires_at) VALUES (?, ?, ?)').run(tokenHash, username, expiresAtMs);
    },

    async getUserSession(tokenHash: string, nowMs: number): Promise<string | null> {
      db.prepare('DELETE FROM user_sessions WHERE expires_at < ?').run(nowMs);
      const rows = db
        .prepare('SELECT username FROM user_sessions WHERE token_hash = ? AND expires_at >= ?')
        .all(tokenHash, nowMs) as Array<{ username: string }>;
      return rows[0]?.username ?? null;
    },

    async deleteUserSession(tokenHash: string): Promise<void> {
      db.prepare('DELETE FROM user_sessions WHERE token_hash = ?').run(tokenHash);
    },

    async deleteUserSessions(username: string): Promise<void> {
      db.prepare('DELETE FROM user_sessions WHERE username = ?').run(username);
    },

    async getAuthSettings(): Promise<AuthSettings | null> {
      const rows = db.prepare('SELECT settings FROM admin_settings WHERE id = 1').all() as Array<{ settings: string }>;
      if (!rows[0]) return null;
      try {
        const parsed = authSettingsSchema.safeParse(JSON.parse(rows[0].settings));
        return parsed.success ? parsed.data : null;
      } catch {
        return null;
      }
    },

    async setAuthSettings(settings: AuthSettings | null): Promise<void> {
      if (settings === null) {
        db.prepare('DELETE FROM admin_settings WHERE id = 1').run();
        return;
      }
      db.prepare(
        `INSERT INTO admin_settings (id, settings, updated_at) VALUES (1, ?, datetime('now'))
         ON CONFLICT(id) DO UPDATE SET settings = excluded.settings, updated_at = excluded.updated_at`,
      ).run(JSON.stringify(settings));
    },

    async close(): Promise<void> {
      db.close();
    },
  };
}
