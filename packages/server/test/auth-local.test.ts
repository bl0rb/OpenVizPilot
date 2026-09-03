import { createHash, generateKeyPairSync } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { encodeLicenseToken, LICENSE_FORMAT_VERSION, signLicensePayload } from '@openvizpilot/ee/server';
import { startMockOidc, type MockOidc } from '../../../ee/test/mock-oidc-server';
import { createApp } from '../src/app';
import type { AppConfig } from '../src/env';
import { testLicenseEnv } from './license-helper';

/**
 * Open-Core-Anmeldung (Benutzerkonten aus der Admin-UI) und die Laufzeit-
 * Umschaltung des Anmeldemodus über /api/admin/auth-settings.
 */

let tmpDirs: string[] = [];
afterEach(() => {
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
  tmpDirs = [];
});

function tmpDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openvizpilot-local-'));
  tmpDirs.push(dir);
  return path.join(dir, 'memory.db');
}

function localConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    litellmBaseUrl: 'http://127.0.0.1:1',
    litellmApiKey: 'sk-test',
    defaultModel: 'test-model',
    modelAllowlist: null,
    port: 0,
    allowedOrigins: [],
    serveStaticDir: null,
    apiAuthToken: null,
    adminToken: 'geheim',
    memoryDatabaseUrl: null,
    memoryDbPath: tmpDbPath(),
    memoryModel: 'memory-model',
    scopeGuardEnabled: false,
    scopeModel: 'scope-model',
    logLevel: 'error',
    authMode: 'local',
    publicUrl: null,
    oidc: null,
    // Die Sitzungsbindung wird über die (lizenzpflichtigen) Präferenzen geprüft.
    licenseEnv: testLicenseEnv(['savedQueries']),
    ...overrides,
  };
}

const admin = { authorization: 'Bearer geheim', 'content-type': 'application/json' };

async function login(app: ReturnType<typeof createApp>['app'], username: string, password: string) {
  return app.request('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password }) });
}

describe('local user login (open core)', () => {
  it('admin creates users; the extension logs in and the session binds the verified user', async () => {
    const { app } = createApp(localConfig());
    // Ohne Sitzung: 401 auth_required, Config meldet Modus local.
    expect(((await (await app.request('/api/auth/config')).json()) as { mode: string }).mode).toBe('local');
    const closed = await app.request('/api/models');
    expect(closed.status).toBe(401);
    expect(((await closed.json()) as { code: string }).code).toBe('auth_required');

    // Anlegen (Validierung: kurzes Passwort → 400, doppelt → 409).
    const short = await app.request('/api/admin/users', { method: 'POST', headers: admin, body: JSON.stringify({ username: 'anna', password: 'kurz' }) });
    expect(short.status).toBe(400);
    const created = await app.request('/api/admin/users', {
      method: 'POST',
      headers: admin,
      body: JSON.stringify({ username: 'anna', displayName: 'Anna Beispiel', password: 'sehr-geheimes-passwort' }),
    });
    expect(created.status).toBe(201);
    const dup = await app.request('/api/admin/users', { method: 'POST', headers: admin, body: JSON.stringify({ username: 'anna', password: 'sehr-geheimes-passwort' }) });
    expect(dup.status).toBe(409);
    const list = (await (await app.request('/api/admin/users', { headers: admin })).json()) as { users: Array<{ username: string; displayName: string }> };
    expect(list.users).toEqual([expect.objectContaining({ username: 'anna', displayName: 'Anna Beispiel', disabled: false })]);

    // Login
    expect((await login(app, 'anna', 'falsch')).status).toBe(401);
    expect((await login(app, 'niemand', 'sehr-geheimes-passwort')).status).toBe(401);
    const ok = await login(app, 'anna', 'sehr-geheimes-passwort');
    expect(ok.status).toBe(200);
    const session = (await ok.json()) as { token: string; expiresAt: number; user: { name: string } };
    expect(session.user.name).toBe('Anna Beispiel');
    expect(session.expiresAt).toBeGreaterThan(Date.now());

    const auth = { authorization: `Bearer ${session.token}` };
    expect((await app.request('/api/commands', { headers: auth })).status).toBe(200);
    // Nutzer-ID kommt aus der Sitzung, nicht aus dem Header.
    const put = await app.request('/api/memory/prefs', {
      method: 'PUT',
      headers: { ...auth, 'content-type': 'application/json', 'x-tableau-user': 'jemand-anderes', 'x-dashboard-key': 'D' },
      body: JSON.stringify({ focus: 'Kurzfassung', questions: [] }),
    });
    expect(put.status).toBe(200);
    const read = await app.request('/api/memory/prefs', { headers: { ...auth, 'x-tableau-user': 'anna', 'x-dashboard-key': 'D' } });
    expect(((await read.json()) as { prefs: { focus: string } | null }).prefs?.focus).toBe('Kurzfassung');

    // Logout beendet die Sitzung serverseitig.
    expect((await app.request('/api/auth/logout', { method: 'POST', headers: auth })).status).toBe(200);
    expect((await app.request('/api/commands', { headers: auth })).status).toBe(401);
  });

  it('locks an account after repeated failures, and disabling/password reset ends sessions', async () => {
    const { app } = createApp(localConfig());
    await app.request('/api/admin/users', { method: 'POST', headers: admin, body: JSON.stringify({ username: 'bob', password: 'sehr-geheimes-passwort' }) });
    for (let i = 0; i < 5; i++) expect((await login(app, 'bob', 'falsch')).status).toBe(401);
    // Gesperrt: auch das richtige Passwort wird abgelehnt — mit derselben
    // 401-Antwort wie bei unbekanntem Benutzer (kein Enumeration-Orakel).
    const locked = await login(app, 'bob', 'sehr-geheimes-passwort');
    expect(locked.status).toBe(401);
    expect(await locked.text()).toBe(await (await login(app, 'gibt-es-nicht', 'sehr-geheimes-passwort')).text());

    // Passwort neu setzen hebt die Sperre auf.
    const reset = await app.request('/api/admin/users/bob/password', { method: 'PUT', headers: admin, body: JSON.stringify({ password: 'neues-langes-passwort' }) });
    expect(reset.status).toBe(200);
    const ok = await login(app, 'bob', 'neues-langes-passwort');
    expect(ok.status).toBe(200);
    const { token } = (await ok.json()) as { token: string };

    // Sperren beendet die laufende Sitzung.
    expect((await app.request('/api/admin/users/bob/disabled', { method: 'PUT', headers: admin, body: JSON.stringify({ disabled: true }) })).status).toBe(200);
    expect((await app.request('/api/commands', { headers: { authorization: `Bearer ${token}` } })).status).toBe(401);
    expect((await login(app, 'bob', 'neues-langes-passwort')).status).toBe(401);

    expect((await app.request('/api/admin/users/bob', { method: 'DELETE', headers: admin })).status).toBe(200);
    expect((await app.request('/api/admin/users/bob', { method: 'DELETE', headers: admin })).status).toBe(404);
    expect((await app.request('/api/admin/users/..%2Fx', { method: 'DELETE', headers: admin })).status).toBe(400);
  });
});

describe('runtime auth settings (admin UI)', () => {
  let idp: MockOidc;
  let licenseToken: string;
  let publicKeyB64url: string;
  beforeAll(async () => {
    idp = await startMockOidc({ clientId: 'ovp-admin-test' });
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    publicKeyB64url = (publicKey.export({ format: 'jwk' }) as { x: string }).x;
    const payload = JSON.stringify({
      formatVersion: LICENSE_FORMAT_VERSION,
      licenseId: 'admin-test',
      tier: 'enterprise',
      licensee: 'Admin GmbH',
      issuedAt: new Date().toISOString(),
      validUntil: new Date(Date.now() + 86_400_000).toISOString(),
    });
    licenseToken = encodeLicenseToken(payload, signLicensePayload(payload, privateKey));
  });
  afterAll(async () => {
    await idp.close();
  });

  it('switches from open to local to SSO without restart, validating license and OIDC first', async () => {
    const { app } = createApp(localConfig({ authMode: 'none', licenseEnv: { OVP_LICENSE_PUBLIC_KEY_B64URL: publicKeyB64url } }));
    expect((await app.request('/api/models')).status).not.toBe(401);

    // SSO ohne Lizenz → abgelehnt, nichts gespeichert.
    const noLicense = await app.request('/api/admin/auth-settings', {
      method: 'PUT',
      headers: admin,
      body: JSON.stringify({ mode: 'oidc', oidc: { provider: 'generic', issuer: idp.issuer, clientId: 'ovp-admin-test', scopes: 'openid' } }),
    });
    expect(noLicense.status).toBe(400);
    expect(((await noLicense.json()) as { error: string }).error).toMatch(/Lizenz/);
    expect((await app.request('/api/models')).status).not.toBe(401);

    // Lizenz mit falscher Signatur → abgelehnt.
    const badLicense = await app.request('/api/admin/auth-settings', {
      method: 'PUT',
      headers: admin,
      body: JSON.stringify({ mode: 'local', license: `${licenseToken.slice(0, -4)}AAAA` }),
    });
    expect(badLicense.status).toBe(400);

    // Benutzerkonten ohne ein einziges Konto → abgelehnt (sonst Aussperrung).
    const noUsers = await app.request('/api/admin/auth-settings', { method: 'PUT', headers: admin, body: JSON.stringify({ mode: 'local' }) });
    expect(noUsers.status).toBe(400);
    expect(((await noUsers.json()) as { error: string }).error).toMatch(/Benutzerkonto/);
    await app.request('/api/admin/users', { method: 'POST', headers: admin, body: JSON.stringify({ username: 'carla', password: 'sehr-geheimes-passwort' }) });

    // Benutzerkonten aktivieren → API zu.
    const local = await app.request('/api/admin/auth-settings', { method: 'PUT', headers: admin, body: JSON.stringify({ mode: 'local' }) });
    expect(local.status).toBe(200);
    expect((await app.request('/api/models')).status).toBe(401);
    expect(((await (await app.request('/api/auth/config')).json()) as { mode: string }).mode).toBe('local');

    // SSO ohne öffentliche URL → abgelehnt (Redirect-URI nie aus dem Host-Header).
    const noUrl = await app.request('/api/admin/auth-settings', {
      method: 'PUT',
      headers: admin,
      body: JSON.stringify({ mode: 'oidc', license: licenseToken, oidc: { provider: 'keycloak', issuer: idp.issuer, clientId: 'ovp-admin-test', scopes: 'openid' } }),
    });
    expect(noUrl.status).toBe(400);
    expect(((await noUrl.json()) as { error: string }).error).toMatch(/öffentliche URL/);

    // Lizenz + OIDC + URL → SSO aktiv, Secret bleibt beim nächsten Speichern erhalten.
    const sso = await app.request('/api/admin/auth-settings', {
      method: 'PUT',
      headers: admin,
      body: JSON.stringify({
        mode: 'oidc',
        license: licenseToken,
        publicUrl: 'http://localhost/',
        oidc: { provider: 'keycloak', issuer: idp.issuer, clientId: 'ovp-admin-test', clientSecret: 'shh', scopes: 'openid profile email' },
      }),
    });
    expect(sso.status).toBe(200);
    const described = (await sso.json()) as {
      effective: { mode: string; source: string; license: { status: string }; redirectUri: string };
      stored: { hasClientSecret: boolean; hasLicense: boolean };
    };
    expect(described.effective).toMatchObject({ mode: 'oidc', source: 'db', redirectUri: 'http://localhost/auth/callback' });
    expect(described.effective.license.status).toBe('valid');
    expect(described.stored).toMatchObject({ hasClientSecret: true, hasLicense: true });
    expect(JSON.stringify(described)).not.toContain('shh');
    expect(JSON.stringify(described)).not.toContain(licenseToken);

    const cfg = (await (await app.request('/api/auth/config')).json()) as { mode: string; providerLabel: string; authorizationEndpoint: string };
    expect(cfg.mode).toBe('oidc');
    expect(cfg.providerLabel).toBe('Keycloak');
    expect(cfg.authorizationEndpoint).toBe(`${idp.issuer}/authorize`);
    const closed = await app.request('/api/models');
    expect(closed.status).toBe(401);

    // Vollständiger Login gegen den Mock-IdP funktioniert mit den DB-Einstellungen.
    const verifier = 'w'.repeat(64);
    const authz = new URL(`${idp.issuer}/authorize`);
    authz.searchParams.set('client_id', 'ovp-admin-test');
    authz.searchParams.set('redirect_uri', 'http://localhost/auth/callback');
    authz.searchParams.set('code_challenge', createHash('sha256').update(verifier).digest('base64url'));
    authz.searchParams.set('code_challenge_method', 'S256');
    authz.searchParams.set('state', 's');
    const code = new URL((await fetch(authz, { redirect: 'manual' })).headers.get('location')!).searchParams.get('code')!;
    const exchanged = await app.request('/api/auth/exchange', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, codeVerifier: verifier, redirectUri: 'http://localhost/auth/callback' }),
    });
    expect(exchanged.status).toBe(200);
    const { token } = (await exchanged.json()) as { token: string };
    expect((await app.request('/api/models', { headers: { authorization: `Bearer ${token}` } })).status).not.toBe(401);

    // Zurück auf Env-Defaults → offen.
    expect((await app.request('/api/admin/auth-settings', { method: 'DELETE', headers: admin })).status).toBe(200);
    expect((await app.request('/api/models')).status).not.toBe(401);
  });
});
