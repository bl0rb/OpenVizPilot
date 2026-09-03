import { dashboardPrefsSchema, type DashboardPrefs } from './personalization-schema';

/**
 * Speicherung der Enterprise-Personalisierung: die Fakten des User-Memory und
 * die gespeicherten eigenen Abfragen je (Nutzer, Dashboard). Eigene Tabellen,
 * eigenes Schema, eigene Nebenläufigkeits-Garantie — der Kern stellt nur die
 * Datenbankverbindung, die er ohnehin für Admin, Anmeldung und Statistik hält.
 *
 * Die Garantie gegen zwei Races der fire-and-forget-Extraktion:
 * (a) eine laufende Extraktion darf per DSGVO-Button gelöschte Fakten nicht
 *     wieder einfügen, (b) zwei parallele Extraktionen dürfen sich nicht
 *     gegenseitig überschreiben.
 * Postgres löst das DB-seitig (Zeilensperre + `epoch` in user_memory_state) und
 * ist damit multi-replica-fähig; SQLite (ein Prozess, eine Datei) über einen
 * In-Process-Guard.
 */

export const MAX_FACTS_PER_USER = 30;
export const MAX_FACT_CHARS = 300;

export interface PersonalizationStore {
  listFacts(userId: string): Promise<string[]>;
  /** Ersetzt die Faktenliste eines Users komplett (Extraktion liefert den Vollstand). */
  replaceFacts(userId: string, facts: string[]): Promise<void>;
  deleteAll(userId: string): Promise<number>;
  /** Aktuelle Änderungsmarke des Users (steigt bei jedem Write/Delete). */
  epoch(userId: string): Promise<number>;
  /** Schreibt nur, wenn sich seit `expectedEpoch` nichts geändert hat. */
  replaceFactsIfUnchanged(userId: string, facts: string[], expectedEpoch: number): Promise<boolean>;
  getPrefs(userId: string, dashboardKey: string): Promise<DashboardPrefs | null>;
  setPrefs(userId: string, dashboardKey: string, prefs: DashboardPrefs): Promise<void>;
}

/**
 * Gemeinsame Normalisierung für beide Backends. Neben Längen-/Anzahl-Caps
 * werden Steuerzeichen sowie <, > und Backticks entfernt — Fakten landen im
 * System-Prompt und dürfen dessen Tag-Struktur nicht aufbrechen können.
 */
export function normalizeFacts(facts: string[]): string[] {
  return facts
    .map((f) =>
      f
        // eslint-disable-next-line no-control-regex
        .replace(/[\u0000-\u001f<>`]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter((f) => f.length > 0)
    .map((f) => (f.length > MAX_FACT_CHARS ? `${f.slice(0, MAX_FACT_CHARS - 1)}…` : f))
    .slice(0, MAX_FACTS_PER_USER);
}

/** Ungültig gespeicherte Präferenzen (altes Schema) gelten als "nicht vorhanden". */
function parsePrefs(raw: string): DashboardPrefs | null {
  try {
    const parsed = dashboardPrefsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- SQLite ----

/** Minimale Sicht auf `node:sqlite` — der Kern reicht sein geöffnetes Handle herein. */
export interface SqliteLike {
  exec(sql: string): void;
  prepare(sql: string): {
    all(...params: unknown[]): unknown[];
    run(...params: unknown[]): { changes: number | bigint };
  };
}

const SQLITE_SCHEMA = `
  CREATE TABLE IF NOT EXISTS user_facts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    fact TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_user_facts_user ON user_facts(user_id);
  CREATE TABLE IF NOT EXISTS user_dashboard_prefs (
    user_id TEXT NOT NULL,
    dashboard_key TEXT NOT NULL,
    prefs TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, dashboard_key)
  );
`;

export function createSqlitePersonalizationStore(db: SqliteLike): PersonalizationStore {
  db.exec(SQLITE_SCHEMA);

  const epochs = new Map<string, number>();
  const locks = new Map<string, Promise<unknown>>();
  const bump = (userId: string) => epochs.set(userId, (epochs.get(userId) ?? 0) + 1);

  /** Serialisiert alle schreibenden Operationen pro User. */
  const withLock = <T>(userId: string, fn: () => Promise<T>): Promise<T> => {
    const prev = locks.get(userId) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    locks.set(
      userId,
      next.catch(() => undefined),
    );
    return next;
  };

  const writeFacts = (userId: string, facts: string[]): void => {
    const cleaned = normalizeFacts(facts);
    db.exec('BEGIN');
    try {
      db.prepare('DELETE FROM user_facts WHERE user_id = ?').run(userId);
      for (const fact of cleaned) {
        db.prepare('INSERT INTO user_facts (user_id, fact) VALUES (?, ?)').run(userId, fact);
      }
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  };

  return {
    async listFacts(userId: string): Promise<string[]> {
      const rows = db
        .prepare('SELECT fact FROM user_facts WHERE user_id = ? ORDER BY id')
        .all(userId) as Array<{ fact: string }>;
      return rows.map((r) => r.fact);
    },

    replaceFacts(userId: string, facts: string[]): Promise<void> {
      return withLock(userId, async () => {
        writeFacts(userId, facts);
        bump(userId);
      });
    },

    deleteAll(userId: string): Promise<number> {
      return withLock(userId, async () => {
        const deleted = Number(db.prepare('DELETE FROM user_facts WHERE user_id = ?').run(userId).changes);
        bump(userId);
        return deleted;
      });
    },

    async epoch(userId: string): Promise<number> {
      return epochs.get(userId) ?? 0;
    },

    replaceFactsIfUnchanged(userId: string, facts: string[], expectedEpoch: number): Promise<boolean> {
      return withLock(userId, async () => {
        if ((epochs.get(userId) ?? 0) !== expectedEpoch) return false;
        writeFacts(userId, facts);
        bump(userId);
        return true;
      });
    },

    async getPrefs(userId: string, dashboardKey: string): Promise<DashboardPrefs | null> {
      const rows = db
        .prepare('SELECT prefs FROM user_dashboard_prefs WHERE user_id = ? AND dashboard_key = ?')
        .all(userId, dashboardKey) as Array<{ prefs: string }>;
      return rows[0] ? parsePrefs(rows[0].prefs) : null;
    },

    async setPrefs(userId: string, dashboardKey: string, prefs: DashboardPrefs): Promise<void> {
      db.prepare(
        `INSERT OR REPLACE INTO user_dashboard_prefs (user_id, dashboard_key, prefs, updated_at)
         VALUES (?, ?, ?, datetime('now'))`,
      ).run(userId, dashboardKey, JSON.stringify(prefs));
    },
  };
}

// ------------------------------------------------------------- Postgres ----

/** Minimale Pool-Sicht — der Kern reicht seinen Pool herein, injizierbar für Tests. */
export interface PgPoolLike {
  query(text: string, values?: unknown[]): Promise<{ rows: unknown[]; rowCount: number | null }>;
  connect(): Promise<{
    query(text: string, values?: unknown[]): Promise<{ rows: unknown[]; rowCount: number | null }>;
    release(): void;
  }>;
}

type PgClient = Awaited<ReturnType<PgPoolLike['connect']>>;

const PG_SCHEMA = `
  CREATE TABLE IF NOT EXISTS user_facts (
    id BIGSERIAL PRIMARY KEY,
    user_id TEXT NOT NULL,
    fact TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS idx_user_facts_user ON user_facts(user_id);
  CREATE TABLE IF NOT EXISTS user_memory_state (
    user_id TEXT PRIMARY KEY,
    epoch BIGINT NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS user_dashboard_prefs (
    user_id TEXT NOT NULL,
    dashboard_key TEXT NOT NULL,
    prefs TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, dashboard_key)
  );
`;

export interface PersonalizationStoreLogger {
  error(msg: string, data?: Record<string, unknown>): void;
}

export function createPgPersonalizationStore(
  pool: PgPoolLike,
  logger: PersonalizationStoreLogger,
): PersonalizationStore {
  // Schema lazy beim ersten Zugriff anlegen (createApp bleibt synchron);
  // bei Fehler versucht es der nächste Zugriff erneut.
  let ready: Promise<void> | null = null;
  const ensureSchema = (): Promise<void> => {
    ready ??= pool
      .query(PG_SCHEMA)
      .then(() => undefined)
      .catch((err: unknown) => {
        ready = null;
        logger.error('personalization schema init failed', { name: err instanceof Error ? err.name : 'unknown' });
        throw err;
      });
    return ready;
  };

  /**
   * Sperrt die Epoch-Zeile des Users (legt sie bei Bedarf an) und gibt die
   * aktuelle Epoch zurück — die Zeilensperre serialisiert konkurrierende
   * Schreiber desselben Users replikaübergreifend bis zum COMMIT/ROLLBACK.
   */
  const lockUserEpoch = async (client: PgClient, userId: string): Promise<number> => {
    await client.query('INSERT INTO user_memory_state (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING', [
      userId,
    ]);
    const result = await client.query('SELECT epoch FROM user_memory_state WHERE user_id = $1 FOR UPDATE', [userId]);
    // pg liefert BIGINT als String.
    return Number((result.rows[0] as { epoch: string | number }).epoch);
  };

  const writeFactsAndBump = async (client: PgClient, userId: string, facts: string[]): Promise<void> => {
    await client.query('DELETE FROM user_facts WHERE user_id = $1', [userId]);
    for (const fact of facts) {
      await client.query('INSERT INTO user_facts (user_id, fact) VALUES ($1, $2)', [userId, fact]);
    }
    await client.query('UPDATE user_memory_state SET epoch = epoch + 1 WHERE user_id = $1', [userId]);
  };

  const inTransaction = async <T>(fn: (client: PgClient) => Promise<T>): Promise<T> => {
    await ensureSchema();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const out = await fn(client);
      await client.query('COMMIT');
      return out;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  };

  return {
    async listFacts(userId: string): Promise<string[]> {
      await ensureSchema();
      const result = await pool.query('SELECT fact FROM user_facts WHERE user_id = $1 ORDER BY id', [userId]);
      return (result.rows as Array<{ fact: string }>).map((r) => r.fact);
    },

    async epoch(userId: string): Promise<number> {
      await ensureSchema();
      const result = await pool.query('SELECT epoch FROM user_memory_state WHERE user_id = $1', [userId]);
      const row = result.rows[0] as { epoch: string | number } | undefined;
      return row ? Number(row.epoch) : 0;
    },

    replaceFacts(userId: string, facts: string[]): Promise<void> {
      return inTransaction(async (client) => {
        await lockUserEpoch(client, userId);
        await writeFactsAndBump(client, userId, normalizeFacts(facts));
      });
    },

    replaceFactsIfUnchanged(userId: string, facts: string[], expectedEpoch: number): Promise<boolean> {
      return inTransaction(async (client) => {
        const current = await lockUserEpoch(client, userId);
        if (current !== expectedEpoch) return false;
        await writeFactsAndBump(client, userId, normalizeFacts(facts));
        return true;
      });
    },

    deleteAll(userId: string): Promise<number> {
      return inTransaction(async (client) => {
        await lockUserEpoch(client, userId);
        const result = await client.query('DELETE FROM user_facts WHERE user_id = $1', [userId]);
        await client.query('UPDATE user_memory_state SET epoch = epoch + 1 WHERE user_id = $1', [userId]);
        return result.rowCount ?? 0;
      });
    },

    async getPrefs(userId: string, dashboardKey: string): Promise<DashboardPrefs | null> {
      await ensureSchema();
      const result = await pool.query(
        'SELECT prefs FROM user_dashboard_prefs WHERE user_id = $1 AND dashboard_key = $2',
        [userId, dashboardKey],
      );
      const row = result.rows[0] as { prefs: string } | undefined;
      return row ? parsePrefs(row.prefs) : null;
    },

    async setPrefs(userId: string, dashboardKey: string, prefs: DashboardPrefs): Promise<void> {
      await ensureSchema();
      await pool.query(
        `INSERT INTO user_dashboard_prefs (user_id, dashboard_key, prefs, updated_at)
         VALUES ($1, $2, $3, now())
         ON CONFLICT (user_id, dashboard_key) DO UPDATE SET prefs = EXCLUDED.prefs, updated_at = now()`,
        [userId, dashboardKey, JSON.stringify(prefs)],
      );
    },
  };
}
