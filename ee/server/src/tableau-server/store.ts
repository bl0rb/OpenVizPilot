import { randomUUID } from 'node:crypto';
import type { PgPoolLike, SqliteLike } from '../personalization-store';
import { tableauConfigSchema, type TableauConfig } from './config';

export interface TableauState {
  config: TableauConfig | null;
  revision: string | null;
}

export interface TableauStore {
  get(): Promise<TableauState>;
  set(config: Omit<TableauConfig, 'revision'> | null, expectedRevision: string | null): Promise<boolean>;
}

function decode(row: { settings: string | null; revision: string | null }): TableauState {
  const config = row.settings ? tableauConfigSchema.parse(JSON.parse(row.settings)) : null;
  if (config && config.revision !== row.revision) throw new Error('Invalid Tableau configuration revision');
  return { config, revision: row.revision };
}

function encode(config: Omit<TableauConfig, 'revision'> | null) {
  const revision = randomUUID();
  return { revision, settings: config ? JSON.stringify(tableauConfigSchema.parse({ ...config, revision })) : null };
}

export function createSqliteTableauStore(db: SqliteLike): TableauStore {
  db.exec(`CREATE TABLE IF NOT EXISTS ee_tableau_server (
    id INTEGER PRIMARY KEY, settings TEXT, revision TEXT
  ); INSERT OR IGNORE INTO ee_tableau_server (id) VALUES (1);`);
  return {
    async get() {
      const rows = db.prepare('SELECT settings, revision FROM ee_tableau_server WHERE id = 1').all();
      return decode(rows[0] as { settings: string | null; revision: string | null });
    },
    async set(config, expectedRevision) {
      const value = encode(config);
      return Number(db.prepare('UPDATE ee_tableau_server SET settings = ?, revision = ? WHERE id = 1 AND revision IS ?')
        .run(value.settings, value.revision, expectedRevision).changes) === 1;
    },
  };
}

export function createPgTableauStore(pool: PgPoolLike): TableauStore {
  let ready: Promise<void> | null = null;
  const ensure = () => ready ??= pool.query(`CREATE TABLE IF NOT EXISTS ee_tableau_server (
    id SMALLINT PRIMARY KEY, settings TEXT, revision TEXT
  ); INSERT INTO ee_tableau_server (id) VALUES (1) ON CONFLICT (id) DO NOTHING;`)
    .then(() => undefined).catch((error: unknown) => { ready = null; throw error; });
  return {
    async get() {
      await ensure();
      const result = await pool.query('SELECT settings, revision FROM ee_tableau_server WHERE id = 1');
      return decode(result.rows[0] as { settings: string | null; revision: string | null });
    },
    async set(config, expectedRevision) {
      await ensure();
      const value = encode(config);
      const result = await pool.query('UPDATE ee_tableau_server SET settings = $1, revision = $2 WHERE id = 1 AND revision IS NOT DISTINCT FROM $3',
        [value.settings, value.revision, expectedRevision]);
      return result.rowCount === 1;
    },
  };
}
