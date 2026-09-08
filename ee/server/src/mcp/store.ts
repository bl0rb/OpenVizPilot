import type { PgPoolLike, SqliteLike } from '../personalization-store';
import { mcpSettingsSchema, type McpSettings, type McpSettingsState } from './schema';

export interface McpStore {
  getMcpSettings(): Promise<McpSettingsState>;
  setMcpSettings(settings: McpSettings, expectedRevision: number): Promise<boolean>;
}

export function createSqliteMcpStore(db: SqliteLike): McpStore {
  db.exec(`CREATE TABLE IF NOT EXISTS ee_mcp (
    id INTEGER PRIMARY KEY, settings TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0
  ); INSERT OR IGNORE INTO ee_mcp (id, settings) VALUES (1, '{"servers":[],"sites":[]}');`);
  return {
    async getMcpSettings() {
      const rows = db.prepare('SELECT settings, revision FROM ee_mcp WHERE id = 1').all() as Array<{ settings: string; revision: number }>;
      const row = rows[0]!;
      return { settings: mcpSettingsSchema.parse(JSON.parse(row.settings)), revision: row.revision };
    },
    async setMcpSettings(settings, expectedRevision) {
      const validated = mcpSettingsSchema.parse(settings);
      return Number(db.prepare('UPDATE ee_mcp SET settings = ?, revision = revision + 1 WHERE id = 1 AND revision = ?').run(JSON.stringify(validated), expectedRevision).changes) === 1;
    },
  };
}

export function createPgMcpStore(pool: PgPoolLike): McpStore {
  let ready: Promise<void> | null = null;
  const ensureSchema = () => {
    ready ??= pool.query(`CREATE TABLE IF NOT EXISTS ee_mcp (
      id SMALLINT PRIMARY KEY, settings TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0
    ); INSERT INTO ee_mcp (id, settings) VALUES (1, '{"servers":[],"sites":[]}') ON CONFLICT (id) DO NOTHING;`)
      .then(() => undefined).catch((error: unknown) => { ready = null; throw error; });
    return ready;
  };
  return {
    async getMcpSettings() {
      await ensureSchema();
      const result = await pool.query('SELECT settings, revision FROM ee_mcp WHERE id = 1');
      const row = result.rows[0] as { settings: string; revision: number };
      return { settings: mcpSettingsSchema.parse(JSON.parse(row.settings)), revision: row.revision };
    },
    async setMcpSettings(settings, expectedRevision) {
      await ensureSchema();
      const validated = mcpSettingsSchema.parse(settings);
      const result = await pool.query('UPDATE ee_mcp SET settings = $1, revision = revision + 1 WHERE id = 1 AND revision = $2', [JSON.stringify(validated), expectedRevision]);
      return result.rowCount === 1;
    },
  };
}