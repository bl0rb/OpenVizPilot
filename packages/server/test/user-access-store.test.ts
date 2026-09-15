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
    expect(migrated).toMatchObject({ provider: 'local', subject: 'legacy', displayName: 'Legacy', ai: false, tableauApi: false });
    const pending = await store.ensureUserAccess(local);
    expect(pending).toMatchObject({ ...local, ai: false, tableauApi: false });
    expect(await store.setUserAccess(pending.id, { ai: true, tableauApi: false })).toBe(true);
    expect(await store.ensureUserAccess({ ...local, displayName: 'Alice Updated', email: 'new@example.test' })).toMatchObject({
      id: pending.id,
      displayName: 'Alice Updated',
      email: 'new@example.test',
      ai: true,
      tableauApi: false,
    });

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
});
