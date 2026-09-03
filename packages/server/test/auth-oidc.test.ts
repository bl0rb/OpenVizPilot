import { createHash, generateKeyPairSync } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { encodeLicenseToken, LICENSE_FORMAT_VERSION, signLicensePayload } from '@openvizpilot/ee/server';
import { startMockOidc, type MockOidc } from '../../../ee/test/mock-oidc-server';
import { createApp } from '../src/app';
import type { AppConfig } from '../src/env';

/**
 * Enterprise-Login Ende-zu-Ende: Lizenz-Gating, Auth-Config, Code-Austausch
 * (BFF) gegen den Mock-IdP, geschützte Routen und die verifizierte Nutzer-ID.
 */

let idp: MockOidc;
let licenseEnv: AppConfig['licenseEnv'];
let tmpDirs: string[] = [];

beforeAll(async () => {
  idp = await startMockOidc({ clientId: 'ovp-ee-test' });
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const payload = JSON.stringify({
    formatVersion: LICENSE_FORMAT_VERSION,
    licenseId: 'test',
    tier: 'enterprise',
    licensee: 'Test GmbH',
    issuedAt: new Date().toISOString(),
    validUntil: new Date(Date.now() + 86_400_000).toISOString(),
    // Ohne features-Liste schaltet das Tier alles frei — inklusive der
    // Präferenzen, über die dieser Test die verifizierte Nutzer-ID prüft.
  });
  licenseEnv = {
    OVP_LICENSE: encodeLicenseToken(payload, signLicensePayload(payload, privateKey)),
    OVP_LICENSE_PUBLIC_KEY_B64URL: (publicKey.export({ format: 'jwk' }) as { x: string }).x,
  };
});
afterAll(async () => {
  await idp.close();
});
afterEach(() => {
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
  tmpDirs = [];
});

function tmpDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openvizpilot-oidc-'));
  tmpDirs.push(dir);
  return path.join(dir, 'memory.db');
}

function oidcConfig(overrides: Partial<AppConfig> = {}): AppConfig {
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
    authMode: 'oidc',
    publicUrl: 'https://chat.example.com',
    oidc: { provider: 'generic', issuer: idp.issuer, clientId: 'ovp-ee-test', clientSecret: null, scopes: 'openid profile email' },
    licenseEnv,
    ...overrides,
  };
}

describe('license gating', () => {
  it('keeps the API closed (503, not open) in OIDC mode without a valid license', async () => {
    const { app } = createApp(oidcConfig({ licenseEnv: {} }));
    const res = await app.request('/api/models');
    expect(res.status).toBe(503);
    expect(((await res.json()) as { code: string }).code).toBe('auth_unavailable');
    const cfg = await app.request('/api/auth/config');
    expect(cfg.status).toBe(503);
    expect(((await cfg.json()) as { mode: string; error: string }).error).toMatch(/Lizenz/);
    // Admin-UI bleibt erreichbar, um die Lizenz nachzutragen.
    expect((await app.request('/api/admin/auth-settings', { headers: { authorization: 'Bearer geheim' } })).status).toBe(200);
  });

  it('exposes the license status to admins and reports open core without a token', async () => {
    const { app } = createApp(oidcConfig());
    const res = await app.request('/api/admin/auth-settings', { headers: { authorization: 'Bearer geheim' } });
    const body = (await res.json()) as { effective: { mode: string; license: { status: string; licensee: string } } };
    expect(body.effective.license.status).toBe('valid');
    expect(body.effective.license.licensee).toBe('Test GmbH');
    expect(body.effective.mode).toBe('oidc');

    const core = createApp(oidcConfig({ authMode: 'none', oidc: null, licenseEnv: {} }));
    const res2 = await core.app.request('/api/admin/auth-settings', { headers: { authorization: 'Bearer geheim' } });
    expect(((await res2.json()) as { effective: { license: { status: string } } }).effective.license.status).toBe('none');
  });
});

describe('OIDC auth flow', () => {
  it('publishes the login config and protects the API until a verified token is presented', async () => {
    const { app } = createApp(oidcConfig());

    const cfg = (await (await app.request('/api/auth/config')).json()) as Record<string, string>;
    expect(cfg.mode).toBe('oidc');
    expect(cfg.clientId).toBe('ovp-ee-test');
    expect(cfg.redirectUri).toBe('https://chat.example.com/auth/callback');
    expect(cfg.authorizationEndpoint).toBe(`${idp.issuer}/authorize`);

    // Ohne Token: 401 mit auth_required — für Chat, Modelle, Befehle, Memory.
    for (const p of ['/api/models', '/api/commands', '/api/memory']) {
      const res = await app.request(p, { headers: { 'x-tableau-user': 'u' } });
      expect(res.status, p).toBe(401);
      expect(((await res.json()) as { code: string }).code).toBe('auth_required');
    }
    // Kaputtes Token: ebenfalls 401.
    expect((await app.request('/api/models', { headers: { authorization: 'Bearer kaputt' } })).status).toBe(401);
    // Öffentliche Endpunkte bleiben offen.
    expect((await app.request('/healthz')).status).toBe(200);
    expect((await app.request('/auth/callback')).status).toBe(200);
    expect(await (await app.request('/auth/callback')).text()).toContain('openvizpilot-oidc');
  });

  it('exchanges a PKCE code via the BFF and binds the verified user to memory', async () => {
    const { app } = createApp(oidcConfig());
    const redirectUri = 'https://chat.example.com/auth/callback';
    const verifier = 'v'.repeat(64);
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const authz = new URL(`${idp.issuer}/authorize`);
    authz.searchParams.set('client_id', 'ovp-ee-test');
    authz.searchParams.set('redirect_uri', redirectUri);
    authz.searchParams.set('code_challenge', challenge);
    authz.searchParams.set('code_challenge_method', 'S256');
    authz.searchParams.set('state', 'st');
    const location = new URL((await fetch(authz, { redirect: 'manual' })).headers.get('location')!);
    const code = location.searchParams.get('code')!;

    // Fremde redirect_uri wird abgelehnt (Code-Injection-Schutz).
    const wrong = await app.request('/api/auth/exchange', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, codeVerifier: verifier, redirectUri: 'https://evil.example/cb' }),
    });
    expect(wrong.status).toBe(400);

    const ok = await app.request('/api/auth/exchange', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, codeVerifier: verifier, redirectUri }),
    });
    expect(ok.status).toBe(200);
    const session = (await ok.json()) as { token: string; expiresAt: number; user: { email?: string } };
    expect(session.user.email).toBe('anna@example.com');

    // Mit dem ID-Token sind die Routen offen …
    const auth = { authorization: `Bearer ${session.token}` };
    expect((await app.request('/api/commands', { headers: auth })).status).toBe(200);

    // … und die Nutzer-ID kommt aus dem Token, nicht aus dem client-asserted Header.
    const memAsOther = await app.request('/api/memory/prefs', {
      method: 'PUT',
      headers: { ...auth, 'content-type': 'application/json', 'x-tableau-user': 'jemand-anderes', 'x-dashboard-key': 'D' },
      body: JSON.stringify({ focus: 'Kurzfassung', questions: [] }),
    });
    expect(memAsOther.status).toBe(200);
    const read = await app.request('/api/memory/prefs', { headers: { ...auth, 'x-tableau-user': 'user-42', 'x-dashboard-key': 'D' } });
    expect(((await read.json()) as { prefs: { focus: string } | null }).prefs?.focus).toBe('Kurzfassung');
    const readOther = await app.request('/api/memory/prefs', { headers: { ...auth, 'x-tableau-user': 'jemand-anderes', 'x-dashboard-key': 'D' } });
    // Gleicher Token → gleicher verifizierter Nutzer, Header egal:
    expect(((await readOther.json()) as { prefs: { focus: string } | null }).prefs?.focus).toBe('Kurzfassung');
  });
});
