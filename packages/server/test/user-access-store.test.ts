import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createLogger } from '../src/logger';
import { userAccessId } from '../src/memory/store';
import { createSqliteMemoryStore, openSqliteDatabase } from '../src/memory/sqlite-store';

const logger = createLogger('error');
let tmpDirs: string[] = [];

afterEach(() => {
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
  tmpDirs = [];
});

function makeDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openvizpilot-access-'));
  tmpDirs.push(dir);
  return openSqliteDatabase(path.join(dir, 'memory.db'));
}

describe('user access persistence', () => {
  it('migrates local users, preserves grants, isolates identities, and deletes local grants', async () => {
    const db = makeDb();
    db.exec(`CREATE TABLE users (
      username TEXT PRIMARY KEY,
      display_name TEXT NOT NULL DEFAULT '',
      password_hash TEXT NOT NULL,
      failed_count INTEGER NOT NULL DEFAULT 0,
      last_failed_at INTEGER,
      locked_until INTEGER,
      disabled INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    db.prepare('INSERT INTO users (username, display_name, password_hash) VALUES (?, ?, ?)').run('legacy', 'Legacy', 'hash');

    const store = createSqliteMemoryStore(db, logger);
    const local = { provider: 'local' as const, issuer: '', subject: 'alice', displayName: 'Alice', email: 'a@example.test' };
    const oidc = { provider: 'oidc' as const, issuer: 'https://idp.example/one', subject: 'alice', displayName: 'Alice SSO', email: 'a@example.test' };
    const otherIssuer = { ...oidc, issuer: 'https://idp.example/two' };

    const migrated = await store.getUserAccess(userAccessId({ provider: 'local', issuer: '', subject: 'legacy' }));
    expect(migrated).toMatchObject({ provider: 'local', subject: 'legacy', displayName: 'Legacy', ai: false, tableauApi: false, admin: false });
    const pending = await store.ensureUserAccess(local);
    expect(pending).toMatchObject({ ...local, ai: false, tableauApi: false, admin: false });
    expect(await store.setUserAccess(pending.id, { ai: true, tableauApi: false })).toBe(true);
    expect(await store.ensureUserAccess({ ...local, displayName: 'Alice Updated', email: 'new@example.test' })).toMatchObject({
      id: pending.id,
      displayName: 'Alice Updated',
      email: 'new@example.test',
      ai: true,
      tableauApi: false,
      admin: false,
    });
    // Admin-Rolle: explizit setzen, ohne `admin` bleibt sie unverändert.
    expect(await store.setUserAccess(pending.id, { ai: true, tableauApi: true, admin: true })).toBe(true);
    expect(await store.getUserAccess(pending.id)).toMatchObject({ ai: true, tableauApi: true, admin: true });
    expect(await store.setUserAccess(pending.id, { ai: false, tableauApi: false })).toBe(true);
    expect(await store.getUserAccess(pending.id)).toMatchObject({ ai: false, tableauApi: false, admin: true });
    expect(await store.setUserAccess(pending.id, { ai: false, tableauApi: false, admin: false })).toBe(true);
    expect((await store.getUserAccess(pending.id))?.admin).toBe(false);

    expect((await store.ensureUserAccess(oidc)).id).not.toBe(pending.id);
    expect((await store.ensureUserAccess(otherIssuer)).id).not.toBe((await store.ensureUserAccess(oidc)).id);
    expect((await store.listUserAccess()).length).toBe(4);
    await store.createUser('alice', 'New Alice', 'hash');
    expect(await store.getUserAccess(pending.id)).toMatchObject({ ai: false, tableauApi: false });

    await store.createUser('recreated', 'Recreated', 'hash');
    const recreated = await store.getUserAccess(userAccessId({ provider: 'local', issuer: '', subject: 'recreated' }));
    expect(recreated).toMatchObject({ ai: false, tableauApi: false });
    await store.setUserAccess(recreated!.id, { ai: true, tableauApi: true });
    expect(await store.deleteUser('recreated')).toBe(true);
    expect(await store.getUserAccess(recreated!.id)).toBeNull();
    await store.createUser('recreated', 'Recreated', 'hash');
    expect(await store.getUserAccess(recreated!.id)).toMatchObject({ ai: false, tableauApi: false });
    await store.close();
  });

  it('adds the admin column to a user_access table created before the role existed', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openvizpilot-access-'));
    tmpDirs.push(dir);
    const dbPath = path.join(dir, 'memory.db');
    const db = openSqliteDatabase(dbPath);
    db.exec(`CREATE TABLE user_access (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      issuer TEXT NOT NULL,
      subject TEXT NOT NULL,
      display_name TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      ai INTEGER NOT NULL DEFAULT 0,
      tableau_api INTEGER NOT NULL DEFAULT 0,
      UNIQUE (provider, issuer, subject)
    )`);
    const id = userAccessId({ provider: 'oidc', issuer: 'https://idp.example', subject: 'old' });
    db.prepare('INSERT INTO user_access (id, provider, issuer, subject, ai) VALUES (?, ?, ?, ?, 1)').run(id, 'oidc', 'https://idp.example', 'old');
    const store = createSqliteMemoryStore(db, logger);
    expect(await store.getUserAccess(id)).toMatchObject({ ai: true, admin: false });
    expect(await store.setUserAccess(id, { ai: true, tableauApi: false, admin: true })).toBe(true);
    expect((await store.getUserAccess(id))?.admin).toBe(true);
    await store.close();
    // Zweiter Start auf derselben Datei: die Nachziehung ist idempotent.
    const reopened = createSqliteMemoryStore(openSqliteDatabase(dbPath), logger);
    expect((await reopened.getUserAccess(id))?.admin).toBe(true);
    await reopened.close();
  });
});
