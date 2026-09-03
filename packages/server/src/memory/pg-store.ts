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
import { Pool } from 'pg';
import type { Logger } from '../logger';
import { generateUsageSalt } from '../usage-pseudonym';
import type { LocalUser, LocalUserAuth, MemoryStore } from './store';

/**
 * Postgres-Backend der Middleware-Datenbank — Produktionspfad auf EKS:
 * Admin-Konto, Anmeldung, Slash-Befehle, Playbooks, Modell-Katalog und die
 * anonyme Nutzungsstatistik. Alle Schreibpfade hier sind Upserts auf
 * Singleton- oder Zähler-Zeilen und damit ohne weitere Vorkehrung
 * multi-replica-sicher.
 *
 * Die Tabellen der Personalisierung (Fakten, gespeicherte eigene Abfragen)
 * gehören zur Enterprise-Edition und liegen mitsamt ihrer Zeilensperr-Garantie
 * in ee/server/src/personalization-store.ts — auf demselben Pool.
 */

/** Minimale Pool-Sicht — injizierbar für Tests, geteilt mit dem ee-Store. */
export interface PgPoolLike {
  query(text: string, values?: unknown[]): Promise<{ rows: unknown[]; rowCount: number | null }>;
  connect(): Promise<{
    query(text: string, values?: unknown[]): Promise<{ rows: unknown[]; rowCount: number | null }>;
    release(): void;
  }>;
  end(): Promise<void>;
}

type PgClient = Awaited<ReturnType<PgPoolLike['connect']>>;

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS admin_slash_commands (
    id SMALLINT PRIMARY KEY,
    commands TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS admin_playbooks (
    dashboard_key TEXT PRIMARY KEY,
    playbook TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS admin_models (
    id SMALLINT PRIMARY KEY,
    catalog TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS usage_stats (
    day TEXT NOT NULL,
    metric TEXT NOT NULL,
    key TEXT NOT NULL,
    count BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (day, metric, key)
  );
  CREATE TABLE IF NOT EXISTS usage_salt (
    id SMALLINT PRIMARY KEY,
    salt TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS usage_dashboards (
    day TEXT NOT NULL,
    dashboard_key TEXT NOT NULL,
    user_token TEXT NOT NULL,
    count BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (day, dashboard_key, user_token)
  );
  CREATE TABLE IF NOT EXISTS admin_account (
    id SMALLINT PRIMARY KEY,
    password_hash TEXT NOT NULL,
    failed_count INTEGER NOT NULL DEFAULT 0,
    last_failed_at BIGINT,
    locked_until BIGINT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS admin_sessions (
    token_hash TEXT PRIMARY KEY,
    expires_at BIGINT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS users (
    username TEXT PRIMARY KEY,
    display_name TEXT NOT NULL DEFAULT '',
    password_hash TEXT NOT NULL,
    failed_count INTEGER NOT NULL DEFAULT 0,
    last_failed_at BIGINT,
    locked_until BIGINT,
    disabled BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS user_sessions (
    token_hash TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    expires_at BIGINT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(username);
  CREATE TABLE IF NOT EXISTS admin_settings (
    id SMALLINT PRIMARY KEY,
    settings TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
`;

/** Ungültig gespeicherte Playbooks (altes Schema) gelten als "nicht vorhanden". */
function parsePlaybook(raw: string): DashboardPlaybook | null {
  try {
    const parsed = dashboardPlaybookSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Erzeugt den Pool — das Handle wird geteilt (siehe store.ts). */
export function openPgPool(databaseUrl: string): PgPoolLike {
  return new Pool({ connectionString: databaseUrl, max: 5, idleTimeoutMillis: 30_000 });
}

export function createPgMemoryStore(pool: PgPoolLike, logger: Logger): MemoryStore {

  // Schema lazy beim ersten Zugriff anlegen (createApp bleibt synchron);
  // bei Fehler wird der nächste Zugriff es erneut versuchen.
  let ready: Promise<void> | null = null;
  const ensureSchema = (): Promise<void> => {
    ready ??= pool
      .query(SCHEMA_SQL)
      .then(() => undefined)
      .catch((err: unknown) => {
        ready = null;
        logger.error('memory schema init failed', {
          name: err instanceof Error ? err.name : 'unknown',
        });
        throw err;
      });
    return ready;
  };

  return {
    async getSlashCommands(): Promise<SlashCommand[] | null> {
      await ensureSchema();
      const result = await pool.query('SELECT commands FROM admin_slash_commands WHERE id = 1');
      const row = result.rows[0] as { commands: string } | undefined;
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
      await ensureSchema();
      if (commands === null) {
        await pool.query('DELETE FROM admin_slash_commands WHERE id = 1');
        return;
      }
      await pool.query(
        `INSERT INTO admin_slash_commands (id, commands, updated_at)
         VALUES (1, $1, now())
         ON CONFLICT (id) DO UPDATE SET commands = EXCLUDED.commands, updated_at = now()`,
        [JSON.stringify(commands)],
      );
    },

    async getModelCatalog(): Promise<ModelOption[] | null> {
      await ensureSchema();
      const result = await pool.query('SELECT catalog FROM admin_models WHERE id = 1');
      const row = result.rows[0] as { catalog: string } | undefined;
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
      await ensureSchema();
      if (catalog === null) {
        await pool.query('DELETE FROM admin_models WHERE id = 1');
        return;
      }
      await pool.query(
        `INSERT INTO admin_models (id, catalog, updated_at)
         VALUES (1, $1, now())
         ON CONFLICT (id) DO UPDATE SET catalog = EXCLUDED.catalog, updated_at = now()`,
        [JSON.stringify(catalog)],
      );
    },

    async getPlaybook(dashboardKey: string): Promise<DashboardPlaybook | null> {
      await ensureSchema();
      const result = await pool.query('SELECT playbook FROM admin_playbooks WHERE dashboard_key = $1', [
        dashboardKey,
      ]);
      const row = result.rows[0] as { playbook: string } | undefined;
      return row ? parsePlaybook(row.playbook) : null;
    },

    async setPlaybook(dashboardKey: string, playbook: DashboardPlaybook | null): Promise<void> {
      await ensureSchema();
      if (playbook === null) {
        await pool.query('DELETE FROM admin_playbooks WHERE dashboard_key = $1', [dashboardKey]);
        return;
      }
      await pool.query(
        `INSERT INTO admin_playbooks (dashboard_key, playbook, updated_at)
         VALUES ($1, $2, now())
         ON CONFLICT (dashboard_key) DO UPDATE SET playbook = EXCLUDED.playbook, updated_at = now()`,
        [dashboardKey, JSON.stringify(playbook)],
      );
    },

    async listPlaybooks() {
      await ensureSchema();
      const result = await pool.query('SELECT dashboard_key, playbook FROM admin_playbooks ORDER BY dashboard_key');
      return (result.rows as Array<{ dashboard_key: string; playbook: string }>).flatMap((r) => {
        const playbook = parsePlaybook(r.playbook);
        return playbook ? [{ dashboardKey: r.dashboard_key, playbook }] : [];
      });
    },

    async recordUsage(events: Array<{ metric: string; key: string }>): Promise<void> {
      if (events.length === 0) return;
      await ensureSchema();
      // EIN Tag für den ganzen Batch — die Events eines Requests treffen
      // praktisch gleichzeitig ein.
      const day = new Date().toISOString().slice(0, 10);
      for (const { metric, key } of events) {
        await pool.query(
          `INSERT INTO usage_stats (day, metric, key, count)
           VALUES ($1, $2, $3, 1)
           ON CONFLICT (day, metric, key) DO UPDATE SET count = usage_stats.count + EXCLUDED.count`,
          [day, metric, key],
        );
      }
    },

    async getUsageStats(
      days: number,
    ): Promise<Array<{ day: string; metric: string; key: string; count: number }>> {
      await ensureSchema();
      const cutoff = new Date(Date.now() - (Math.max(1, days) - 1) * 86_400_000).toISOString().slice(0, 10);
      const result = await pool.query(
        'SELECT day, metric, key, count FROM usage_stats WHERE day >= $1 ORDER BY day DESC, metric, key',
        [cutoff],
      );
      return (
        result.rows as Array<{ day: string; metric: string; key: string; count: string | number }>
      ).map((r) => ({ day: r.day, metric: r.metric, key: r.key, count: Number(r.count) }));
    },

    async getUsageSalt(): Promise<string> {
      await ensureSchema();
      // Race-sicher über alle Replicas: bedingter Insert, dann lesen.
      await pool.query('INSERT INTO usage_salt (id, salt) VALUES (1, $1) ON CONFLICT (id) DO NOTHING', [
        generateUsageSalt(),
      ]);
      const result = await pool.query('SELECT salt FROM usage_salt WHERE id = 1');
      return (result.rows[0] as { salt: string }).salt;
    },

    async recordDashboardUsage(dashboardKey: string, userToken: string): Promise<void> {
      await ensureSchema();
      const day = new Date().toISOString().slice(0, 10);
      await pool.query(
        `INSERT INTO usage_dashboards (day, dashboard_key, user_token, count)
         VALUES ($1, $2, $3, 1)
         ON CONFLICT (day, dashboard_key, user_token) DO UPDATE SET count = usage_dashboards.count + EXCLUDED.count`,
        [day, dashboardKey, userToken],
      );
    },

    async getDashboardUsage(days: number) {
      await ensureSchema();
      const cutoff = new Date(Date.now() - (Math.max(1, days) - 1) * 86_400_000).toISOString().slice(0, 10);
      const result = await pool.query(
        `SELECT dashboard_key, user_token, SUM(count) AS questions
         FROM usage_dashboards WHERE day >= $1
         GROUP BY dashboard_key, user_token`,
        [cutoff],
      );
      return (result.rows as Array<{ dashboard_key: string; user_token: string; questions: string | number }>).map(
        (r) => ({ dashboardKey: r.dashboard_key, userToken: r.user_token, questions: Number(r.questions) }),
      );
    },

    async getAdminAccount() {
      await ensureSchema();
      const result = await pool.query(
        'SELECT password_hash, failed_count, last_failed_at, locked_until FROM admin_account WHERE id = 1',
      );
      const row = result.rows[0] as
        | {
            password_hash: string;
            failed_count: number | string;
            last_failed_at: number | string | null;
            locked_until: number | string | null;
          }
        | undefined;
      if (!row) return null;
      return {
        passwordHash: row.password_hash,
        failedCount: Number(row.failed_count),
        lastFailedAt: row.last_failed_at === null ? null : Number(row.last_failed_at),
        lockedUntil: row.locked_until === null ? null : Number(row.locked_until),
      };
    },

    async createAdminAccount(passwordHash: string): Promise<boolean> {
      await ensureSchema();
      // Race-sicher über alle Replicas: der bedingte Insert auf die
      // Singleton-Zeile lässt genau eine Ersteinrichtung gewinnen.
      const result = await pool.query(
        'INSERT INTO admin_account (id, password_hash) VALUES (1, $1) ON CONFLICT (id) DO NOTHING',
        [passwordHash],
      );
      return (result.rowCount ?? 0) === 1;
    },

    async registerFailedAdminLogin(nowMs: number, windowMs: number): Promise<number> {
      await ensureSchema();
      // Atomar in EINEM Statement zählen (siehe store.ts-Interface) — auch
      // replikaübergreifend korrekt, da die Zeile beim UPDATE gesperrt ist.
      const result = await pool.query(
        `UPDATE admin_account
         SET failed_count = CASE WHEN last_failed_at IS NULL OR $1 - last_failed_at > $2 THEN 1 ELSE failed_count + 1 END,
             last_failed_at = $1
         WHERE id = 1
         RETURNING failed_count`,
        [nowMs, windowMs],
      );
      const row = result.rows[0] as { failed_count: string | number } | undefined;
      return row ? Number(row.failed_count) : 0;
    },

    async lockAdminAccount(untilMs: number): Promise<void> {
      await ensureSchema();
      await pool.query('UPDATE admin_account SET locked_until = $1, failed_count = 0 WHERE id = 1', [
        untilMs,
      ]);
    },

    async resetAdminLoginFailures(): Promise<void> {
      await ensureSchema();
      await pool.query(
        'UPDATE admin_account SET failed_count = 0, last_failed_at = NULL, locked_until = NULL WHERE id = 1',
      );
    },

    async createAdminSession(tokenHash: string, expiresAtMs: number): Promise<void> {
      await ensureSchema();
      await pool.query('INSERT INTO admin_sessions (token_hash, expires_at) VALUES ($1, $2)', [
        tokenHash,
        expiresAtMs,
      ]);
    },

    async hasAdminSession(tokenHash: string, nowMs: number): Promise<boolean> {
      await ensureSchema();
      await pool.query('DELETE FROM admin_sessions WHERE expires_at < $1', [nowMs]);
      const result = await pool.query(
        'SELECT 1 FROM admin_sessions WHERE token_hash = $1 AND expires_at >= $2',
        [tokenHash, nowMs],
      );
      return (result.rows as unknown[]).length > 0;
    },

    async deleteAdminSession(tokenHash: string): Promise<void> {
      await ensureSchema();
      await pool.query('DELETE FROM admin_sessions WHERE token_hash = $1', [tokenHash]);
    },

    async listUsers(): Promise<LocalUser[]> {
      await ensureSchema();
      const result = await pool.query('SELECT username, display_name, disabled, created_at FROM users ORDER BY username');
      return (result.rows as Array<{ username: string; display_name: string; disabled: boolean; created_at: string | Date }>).map((r) => ({
        username: r.username,
        displayName: r.display_name,
        disabled: Boolean(r.disabled),
        createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
      }));
    },

    async getUserAuth(username: string): Promise<LocalUserAuth | null> {
      await ensureSchema();
      const result = await pool.query(
        'SELECT username, display_name, password_hash, failed_count, last_failed_at, locked_until, disabled, created_at FROM users WHERE username = $1',
        [username],
      );
      const r = result.rows[0] as
        | {
            username: string;
            display_name: string;
            password_hash: string;
            failed_count: number | string;
            last_failed_at: number | string | null;
            locked_until: number | string | null;
            disabled: boolean;
            created_at: string | Date;
          }
        | undefined;
      if (!r) return null;
      return {
        username: r.username,
        displayName: r.display_name,
        passwordHash: r.password_hash,
        failedCount: Number(r.failed_count),
        lastFailedAt: r.last_failed_at === null ? null : Number(r.last_failed_at),
        lockedUntil: r.locked_until === null ? null : Number(r.locked_until),
        disabled: Boolean(r.disabled),
        createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
      };
    },

    async createUser(username: string, displayName: string, passwordHash: string): Promise<boolean> {
      await ensureSchema();
      const result = await pool.query(
        'INSERT INTO users (username, display_name, password_hash) VALUES ($1, $2, $3) ON CONFLICT (username) DO NOTHING',
        [username, displayName, passwordHash],
      );
      return (result.rowCount ?? 0) === 1;
    },

    async setUserPassword(username: string, passwordHash: string): Promise<boolean> {
      await ensureSchema();
      const result = await pool.query('UPDATE users SET password_hash = $1 WHERE username = $2', [passwordHash, username]);
      return (result.rowCount ?? 0) === 1;
    },

    async setUserDisabled(username: string, disabled: boolean): Promise<boolean> {
      await ensureSchema();
      const result = await pool.query('UPDATE users SET disabled = $1 WHERE username = $2', [disabled, username]);
      return (result.rowCount ?? 0) === 1;
    },

    async deleteUser(username: string): Promise<boolean> {
      await ensureSchema();
      await pool.query('DELETE FROM user_sessions WHERE username = $1', [username]);
      const result = await pool.query('DELETE FROM users WHERE username = $1', [username]);
      return (result.rowCount ?? 0) === 1;
    },

    async registerFailedUserLogin(username: string, nowMs: number, windowMs: number): Promise<number> {
      await ensureSchema();
      const result = await pool.query(
        `UPDATE users
         SET failed_count = CASE WHEN last_failed_at IS NULL OR $1 - last_failed_at > $2 THEN 1 ELSE failed_count + 1 END,
             last_failed_at = $1
         WHERE username = $3
         RETURNING failed_count`,
        [nowMs, windowMs, username],
      );
      const row = result.rows[0] as { failed_count: string | number } | undefined;
      return row ? Number(row.failed_count) : 0;
    },

    async lockUser(username: string, untilMs: number): Promise<void> {
      await ensureSchema();
      await pool.query('UPDATE users SET locked_until = $1, failed_count = 0 WHERE username = $2', [untilMs, username]);
    },

    async resetUserLoginFailures(username: string): Promise<void> {
      await ensureSchema();
      await pool.query('UPDATE users SET failed_count = 0, last_failed_at = NULL, locked_until = NULL WHERE username = $1', [username]);
    },

    async createUserSession(tokenHash: string, username: string, expiresAtMs: number): Promise<void> {
      await ensureSchema();
      await pool.query('INSERT INTO user_sessions (token_hash, username, expires_at) VALUES ($1, $2, $3)', [tokenHash, username, expiresAtMs]);
    },

    async getUserSession(tokenHash: string, nowMs: number): Promise<string | null> {
      await ensureSchema();
      await pool.query('DELETE FROM user_sessions WHERE expires_at < $1', [nowMs]);
      const result = await pool.query('SELECT username FROM user_sessions WHERE token_hash = $1 AND expires_at >= $2', [tokenHash, nowMs]);
      return (result.rows[0] as { username: string } | undefined)?.username ?? null;
    },

    async deleteUserSession(tokenHash: string): Promise<void> {
      await ensureSchema();
      await pool.query('DELETE FROM user_sessions WHERE token_hash = $1', [tokenHash]);
    },

    async deleteUserSessions(username: string): Promise<void> {
      await ensureSchema();
      await pool.query('DELETE FROM user_sessions WHERE username = $1', [username]);
    },

    async getAuthSettings(): Promise<AuthSettings | null> {
      await ensureSchema();
      const result = await pool.query('SELECT settings FROM admin_settings WHERE id = 1');
      const row = result.rows[0] as { settings: string } | undefined;
      if (!row) return null;
      try {
        const parsed = authSettingsSchema.safeParse(JSON.parse(row.settings));
        return parsed.success ? parsed.data : null;
      } catch {
        return null;
      }
    },

    async setAuthSettings(settings: AuthSettings | null): Promise<void> {
      await ensureSchema();
      if (settings === null) {
        await pool.query('DELETE FROM admin_settings WHERE id = 1');
        return;
      }
      await pool.query(
        `INSERT INTO admin_settings (id, settings, updated_at) VALUES (1, $1, now())
         ON CONFLICT (id) DO UPDATE SET settings = EXCLUDED.settings, updated_at = now()`,
        [JSON.stringify(settings)],
      );
    },

    async close(): Promise<void> {
      await pool.end();
    },
  };
}
