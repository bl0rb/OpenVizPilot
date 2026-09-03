import { randomUUID } from 'node:crypto';
import type { PgPoolLike, SqliteLike } from './personalization-store';
import type { TelemetryStore } from './telemetry';

/**
 * Zustand des Lizenz-Heartbeats: die dauerhafte Installations-ID und wann
 * zuletzt gesendet wurde. Eine einzige Zeile, auf derselben Verbindung wie der
 * Rest — eigene Tabelle, weil auch das eine Enterprise-Funktion ist.
 *
 * Der Anspruch auf ein Sende-Intervall (`claimHeartbeat`) ist ein bedingtes
 * UPDATE: Bei mehreren Replicas gewinnt genau eine, alle anderen bekommen
 * `false` und senden nicht. Kein Read-Modify-Write im Prozess — das würde bei
 * gleichzeitigen Ticks mehrfach senden.
 */

const SQLITE_SCHEMA = `
  CREATE TABLE IF NOT EXISTS ee_telemetry_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    installation_id TEXT NOT NULL,
    last_attempt_at INTEGER,
    last_ok_at INTEGER,
    last_detail TEXT
  );
`;

const PG_SCHEMA = `
  CREATE TABLE IF NOT EXISTS ee_telemetry_state (
    id SMALLINT PRIMARY KEY,
    installation_id TEXT NOT NULL,
    last_attempt_at BIGINT,
    last_ok_at BIGINT,
    last_detail TEXT
  );
`;

interface StateRow {
  installation_id: string;
  last_attempt_at: number | string | null;
  last_ok_at: number | string | null;
  last_detail: string | null;
}

function toState(row: StateRow | undefined) {
  return {
    lastAttemptAt: row?.last_attempt_at == null ? null : Number(row.last_attempt_at),
    lastOkAt: row?.last_ok_at == null ? null : Number(row.last_ok_at),
    lastDetail: row?.last_detail ?? null,
  };
}

export function createSqliteTelemetryStore(db: SqliteLike): TelemetryStore {
  db.exec(SQLITE_SCHEMA);

  const ensureRow = (): StateRow => {
    // Race-sicher wie das Admin-Konto: bedingter Insert auf die Singleton-Zeile.
    db.prepare('INSERT INTO ee_telemetry_state (id, installation_id) VALUES (1, ?) ON CONFLICT(id) DO NOTHING').run(randomUUID());
    return (db.prepare('SELECT * FROM ee_telemetry_state WHERE id = 1').all() as StateRow[])[0]!;
  };

  return {
    async getInstallationId(): Promise<string> {
      return ensureRow().installation_id;
    },

    async claimHeartbeat(nowMs: number, intervalMs: number): Promise<boolean> {
      ensureRow();
      const changed = db
        .prepare(
          `UPDATE ee_telemetry_state
           SET last_attempt_at = ?
           WHERE id = 1 AND (last_attempt_at IS NULL OR ? - last_attempt_at >= ?)`,
        )
        .run(nowMs, nowMs, intervalMs).changes;
      return Number(changed) === 1;
    },

    async recordHeartbeatResult(nowMs: number, ok: boolean, detail: string): Promise<void> {
      db.prepare(
        `UPDATE ee_telemetry_state
         SET last_detail = ?, last_ok_at = CASE WHEN ? = 1 THEN ? ELSE last_ok_at END
         WHERE id = 1`,
      ).run(detail, ok ? 1 : 0, nowMs);
    },

    async getHeartbeatState() {
      return toState((db.prepare('SELECT * FROM ee_telemetry_state WHERE id = 1').all() as StateRow[])[0]);
    },
  };
}

export interface TelemetryStoreLogger {
  error(msg: string, data?: Record<string, unknown>): void;
}

export function createPgTelemetryStore(pool: PgPoolLike, logger: TelemetryStoreLogger): TelemetryStore {
  let ready: Promise<void> | null = null;
  const ensureSchema = (): Promise<void> => {
    ready ??= pool
      .query(PG_SCHEMA)
      .then(() => undefined)
      .catch((err: unknown) => {
        ready = null;
        logger.error('telemetry schema init failed', { name: err instanceof Error ? err.name : 'unknown' });
        throw err;
      });
    return ready;
  };

  const ensureRow = async (): Promise<StateRow> => {
    await ensureSchema();
    await pool.query('INSERT INTO ee_telemetry_state (id, installation_id) VALUES (1, $1) ON CONFLICT (id) DO NOTHING', [
      randomUUID(),
    ]);
    const result = await pool.query('SELECT * FROM ee_telemetry_state WHERE id = 1');
    return result.rows[0] as StateRow;
  };

  return {
    async getInstallationId(): Promise<string> {
      return (await ensureRow()).installation_id;
    },

    async claimHeartbeat(nowMs: number, intervalMs: number): Promise<boolean> {
      await ensureRow();
      const result = await pool.query(
        `UPDATE ee_telemetry_state
         SET last_attempt_at = $1
         WHERE id = 1 AND (last_attempt_at IS NULL OR $1 - last_attempt_at >= $2)`,
        [nowMs, intervalMs],
      );
      return (result.rowCount ?? 0) === 1;
    },

    async recordHeartbeatResult(nowMs: number, ok: boolean, detail: string): Promise<void> {
      await ensureSchema();
      await pool.query(
        `UPDATE ee_telemetry_state
         SET last_detail = $1, last_ok_at = CASE WHEN $2 THEN $3 ELSE last_ok_at END
         WHERE id = 1`,
        [detail, ok, nowMs],
      );
    },

    async getHeartbeatState() {
      await ensureSchema();
      const result = await pool.query('SELECT * FROM ee_telemetry_state WHERE id = 1');
      return toState(result.rows[0] as StateRow | undefined);
    },
  };
}
