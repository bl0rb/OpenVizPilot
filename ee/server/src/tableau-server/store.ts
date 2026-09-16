import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { PgPoolLike, SqliteLike } from '../personalization-store';
import { tableauConfigSchema, type TableauConfig } from './config';
import type { TableauEasKey } from './eas';

export interface TableauState {
  config: TableauConfig | null;
  revision: string | null;
}

export interface TableauStore {
  get(): Promise<TableauState>;
  set(config: Omit<TableauConfig, 'revision'> | null, expectedRevision: string | null): Promise<boolean>;
  /** Der EAS-Schlüssel für den OAuth-2.0-Trust-Modus, falls schon einer erzeugt wurde. */
  getEasKey(): Promise<TableauEasKey | null>;
  /**
   * Legt den EAS-Schlüssel an, aber nur, solange noch keiner existiert ("first wins") — so benutzen
   * mehrere Replicas denselben Schlüssel. Der Aufrufer liest danach mit `getEasKey()` erneut, um den
   * tatsächlich gewonnenen Schlüssel zu erhalten (das kann ein anderer als der übergebene sein).
   */
  saveEasKey(key: TableauEasKey): Promise<void>;
}

const easPublicJwkSchema = z.object({
  kty: z.literal('RSA'),
  n: z.string().min(1),
  e: z.string().min(1),
  kid: z.string().min(1),
  use: z.literal('sig'),
  alg: z.literal('RS256'),
}).strict();

/** Validiert Form und Typ des persistierten Schlüssels — Schutz gegen eine beschädigte oder fremde Zeile. */
const easKeySchema = z.object({
  kid: z.string().min(1),
  privateKeyPem: z.string().min(1),
  publicJwk: easPublicJwkSchema,
  createdAt: z.string(),
}).strict();

function encodeEasKey(key: TableauEasKey): string {
  return JSON.stringify(easKeySchema.parse(key));
}

function decodeEasKey(raw: string): TableauEasKey {
  return easKeySchema.parse(JSON.parse(raw));
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
  ); INSERT OR IGNORE INTO ee_tableau_server (id) VALUES (1);
  CREATE TABLE IF NOT EXISTS ee_tableau_eas_key (
    id INTEGER PRIMARY KEY, key TEXT NOT NULL, created_at TEXT NOT NULL
  );`);
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
    async getEasKey() {
      const rows = db.prepare('SELECT key FROM ee_tableau_eas_key WHERE id = 1').all();
      const row = rows[0] as { key: string } | undefined;
      return row ? decodeEasKey(row.key) : null;
    },
    async saveEasKey(key) {
      db.prepare('INSERT OR IGNORE INTO ee_tableau_eas_key (id, key, created_at) VALUES (1, ?, ?)')
        .run(encodeEasKey(key), key.createdAt);
    },
  };
}

export function createPgTableauStore(pool: PgPoolLike): TableauStore {
  let ready: Promise<void> | null = null;
  const ensure = () => ready ??= pool.query(`CREATE TABLE IF NOT EXISTS ee_tableau_server (
    id SMALLINT PRIMARY KEY, settings TEXT, revision TEXT
  ); INSERT INTO ee_tableau_server (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
  CREATE TABLE IF NOT EXISTS ee_tableau_eas_key (
    id SMALLINT PRIMARY KEY, key TEXT NOT NULL, created_at TEXT NOT NULL
  );`)
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
    async getEasKey() {
      await ensure();
      const result = await pool.query('SELECT key FROM ee_tableau_eas_key WHERE id = 1');
      const row = result.rows[0] as { key: string } | undefined;
      return row ? decodeEasKey(row.key) : null;
    },
    async saveEasKey(key) {
      await ensure();
      await pool.query('INSERT INTO ee_tableau_eas_key (id, key, created_at) VALUES (1, $1, $2) ON CONFLICT (id) DO NOTHING',
        [encodeEasKey(key), key.createdAt]);
    },
  };
}
