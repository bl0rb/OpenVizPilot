import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { hashPassword, verifyPassword } from '../src/admin-auth';
import { createApp } from '../src/app';
import type { AppConfig } from '../src/env';
import { createSqliteMemoryStore, openSqliteDatabase } from '../src/memory/sqlite-store';
import { createLogger } from '../src/logger';

/**
 * First-Run-Admin (Passwort-Modus): Ersteinrichtung beim ersten Zugriff,
 * Login mit Lockout, DB-Sessions — Gegenstück zu routes/admin.ts und
 * admin-auth.ts (Muster wie in PaddleDoc).
 */

let tmpDirs: string[] = [];

function tmpDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openvizpilot-admin-setup-'));
  tmpDirs.push(dir);
  return path.join(dir, 'memory.db');
}

afterEach(() => {
  vi.useRealTimers();
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
  tmpDirs = [];
});

function passwordModeConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    litellmBaseUrl: 'http://127.0.0.1:1',
    litellmApiKey: 'sk-test',
    defaultModel: 'test-model',
    modelAllowlist: null,
    port: 0,
    allowedOrigins: [],
    serveStaticDir: null,
    apiAuthToken: null,
    adminToken: null,
    memoryDatabaseUrl: null,
    memoryDbPath: tmpDbPath(),
    memoryModel: 'memory-model',
    scopeGuardEnabled: false,
    scopeModel: 'scope-model',
    logLevel: 'error',
    authMode: 'none',
    publicUrl: null,
    oidc: null,
    // Tests senden nie nach außen.
    telemetryEndpoint: '',
    appVersion: 'test',
    licenseEnv: {},
    ...overrides,
  };
}

const json = (body: unknown) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

const GOOD_PASSWORD = 'streng-geheim-123';

describe('admin-auth password hashing', () => {
  it('roundtrips and rejects wrong or malformed input', async () => {
    const stored = await hashPassword(GOOD_PASSWORD);
    expect(stored.startsWith('scrypt$')).toBe(true);
    expect(await verifyPassword(GOOD_PASSWORD, stored)).toBe(true);
    expect(await verifyPassword('falsch', stored)).toBe(false);
    expect(await verifyPassword(GOOD_PASSWORD, 'kaputt')).toBe(false);
    expect(await verifyPassword(GOOD_PASSWORD, 'scrypt$abc$8$1$00$00')).toBe(false);
  });

  it('salts every hash', async () => {
    expect(await hashPassword(GOOD_PASSWORD)).not.toBe(await hashPassword(GOOD_PASSWORD));
  });
});

describe('sqlite admin account/session store', () => {
  it('creates the account exactly once and tracks sessions with expiry', async () => {
    const store = createSqliteMemoryStore(openSqliteDatabase(tmpDbPath()), createLogger('error'));
    expect(await store.getAdminAccount()).toBeNull();
    expect(await store.createAdminAccount('hash-1')).toBe(true);
    expect(await store.createAdminAccount('hash-2')).toBe(false);
    expect((await store.getAdminAccount())?.passwordHash).toBe('hash-1');

    const now = Date.now();
    await store.createAdminSession('tok-a', now + 1000);
    await store.createAdminSession('tok-b', now - 1);
    expect(await store.hasAdminSession('tok-a', now)).toBe(true);
    expect(await store.hasAdminSession('tok-b', now)).toBe(false);
    await store.deleteAdminSession('tok-a');
    expect(await store.hasAdminSession('tok-a', now)).toBe(false);
    await store.close();
  });

  it('counts failed logins atomically, restarts after the window, resets and locks', async () => {
    const store = createSqliteMemoryStore(openSqliteDatabase(tmpDbPath()), createLogger('error'));
    await store.createAdminAccount('hash');
    const window = 1000;
    expect(await store.registerFailedAdminLogin(10_000, window)).toBe(1);
    expect(await store.registerFailedAdminLogin(10_100, window)).toBe(2);
    // Fenster abgelaufen → Zähler startet neu bei 1.
    expect(await store.registerFailedAdminLogin(20_000, window)).toBe(1);
    await store.lockAdminAccount(99_999);
    expect((await store.getAdminAccount())?.lockedUntil).toBe(99_999);
    await store.resetAdminLoginFailures();
    const account = await store.getAdminAccount();
    expect(account?.failedCount).toBe(0);
    expect(account?.lockedUntil).toBeNull();
    await store.close();
  });
});

describe('first-run admin setup (password mode)', () => {
  it('serves /admin without an ADMIN_TOKEN when a store exists', async () => {
    const { app } = createApp(passwordModeConfig());
    const res = await app.request('/admin');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('gate-setup');
  });

  it('walks setup → login → session → logout', async () => {
    const { app } = createApp(passwordModeConfig());

    // 1) Frischer Server: Modus "setup".
    let status = await app.request('/api/admin/auth-status');
    expect(((await status.json()) as { mode: string }).mode).toBe('setup');

    // 2) Zu kurzes Passwort wird abgelehnt.
    expect((await app.request('/api/admin/setup', json({ password: 'kurz' }))).status).toBe(400);

    // 3) Einrichtung liefert eine Session; danach Modus "login" und 409 für
    //    jede weitere Einrichtung.
    const setupRes = await app.request('/api/admin/setup', json({ password: GOOD_PASSWORD }));
    expect(setupRes.status).toBe(200);
    const { token } = (await setupRes.json()) as { token: string };
    expect(token.length).toBeGreaterThan(30);
    status = await app.request('/api/admin/auth-status');
    expect(((await status.json()) as { mode: string }).mode).toBe('login');
    expect((await app.request('/api/admin/setup', json({ password: GOOD_PASSWORD }))).status).toBe(409);

    // 4) Session-Token funktioniert auf geschützten Endpunkten (auch /trex).
    const auth = { headers: { authorization: `Bearer ${token}` } };
    expect((await app.request('/api/admin/commands', auth)).status).toBe(200);
    expect((await app.request('/api/admin/trex?url=https://chat.example.com/', auth)).status).toBe(200);
    expect((await app.request('/api/admin/commands')).status).toBe(401);

    // 5) Logout invalidiert die Session.
    expect((await app.request('/api/admin/logout', { ...auth, method: 'POST' })).status).toBe(200);
    expect((await app.request('/api/admin/commands', auth)).status).toBe(401);

    // 6) Login mit falschem/richtigem Passwort.
    expect((await app.request('/api/admin/login', json({ password: 'falsch-falsch' }))).status).toBe(401);
    const loginRes = await app.request('/api/admin/login', json({ password: GOOD_PASSWORD }));
    expect(loginRes.status).toBe(200);
    const { token: token2 } = (await loginRes.json()) as { token: string };
    expect((await app.request('/api/admin/commands', { headers: { authorization: `Bearer ${token2}` } })).status).toBe(200);
  });

  it('locks the account after repeated failures and unlocks after the window', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-02T12:00:00Z'));
    const { app } = createApp(passwordModeConfig());
    await app.request('/api/admin/setup', json({ password: GOOD_PASSWORD }));

    for (let i = 0; i < 5; i += 1) {
      expect((await app.request('/api/admin/login', json({ password: 'falsch-falsch' }))).status).toBe(401);
    }
    // Gesperrt — auch mit korrektem Passwort.
    expect((await app.request('/api/admin/login', json({ password: GOOD_PASSWORD }))).status).toBe(429);

    // Nach Ablauf der Sperre klappt der Login wieder.
    vi.setSystemTime(new Date('2026-09-02T12:16:00Z'));
    expect((await app.request('/api/admin/login', json({ password: GOOD_PASSWORD }))).status).toBe(200);
  });

  it('locks even under a parallel burst of wrong passwords (atomic counting)', async () => {
    const { app } = createApp(passwordModeConfig());
    await app.request('/api/admin/setup', json({ password: GOOD_PASSWORD }));

    // 12 gleichzeitige Falsch-Logins OHNE await dazwischen — mit
    // Read-Modify-Write würde der Zähler bei 1 hängen bleiben und die
    // Sperre nie greifen (der Review-Fund, den dieser Test festnagelt).
    const results = await Promise.all(
      Array.from({ length: 12 }, () => app.request('/api/admin/login', json({ password: 'falsch-falsch' }))),
    );
    expect(results.every((r) => r.status === 401 || r.status === 429)).toBe(true);
    // Danach ist das Konto gesperrt — auch für das korrekte Passwort.
    expect((await app.request('/api/admin/login', json({ password: GOOD_PASSWORD }))).status).toBe(429);
  });

  it('keeps setup/login disabled in token mode', async () => {
    const { app } = createApp(passwordModeConfig({ adminToken: 'geheim' }));
    const status = await app.request('/api/admin/auth-status');
    expect(((await status.json()) as { mode: string }).mode).toBe('token');
    expect((await app.request('/api/admin/setup', json({ password: GOOD_PASSWORD }))).status).toBe(400);
    expect((await app.request('/api/admin/login', json({ password: GOOD_PASSWORD }))).status).toBe(400);
    // Statisches Token funktioniert weiterhin.
    const res = await app.request('/api/admin/commands', { headers: { authorization: 'Bearer geheim' } });
    expect(res.status).toBe(200);
  });

  it('stays fully disabled without token AND without store', async () => {
    const { app } = createApp(passwordModeConfig({ memoryDbPath: null }));
    expect((await app.request('/admin')).status).toBe(404);
    expect((await app.request('/api/admin/auth-status')).status).toBe(404);
    expect((await app.request('/api/admin/setup', json({ password: GOOD_PASSWORD }))).status).toBe(404);
  });
});
