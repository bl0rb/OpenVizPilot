import { createPublicKey, verify as cryptoVerify } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openSqliteDatabase } from '../../packages/server/src/memory/sqlite-store';
import { TableauClient, type TableauSignInUser } from '../server/src/tableau-server/client';
import { tableauConfigInputSchema, tableauConfigSchema, type TableauConfig } from '../server/src/tableau-server/config';
import { EAS_PATH, easIssuerUrl, generateEasKey, type TableauEasKey } from '../server/src/tableau-server/eas';
import { createTableauEasRoute } from '../server/src/tableau-server/eas-routes';
import { createTableauAdminRoute } from '../server/src/tableau-server/routes';
import { TableauService, type TableauAccess } from '../server/src/tableau-server/service';
import { createSqliteTableauStore } from '../server/src/tableau-server/store';
import type { TableauTransport, TableauTransportRequest } from '../server/src/tableau-server/http';

const REVISION = '11111111-1111-4111-8111-111111111111';
const SITE_ID = '22222222-2222-4222-8222-222222222222';
const PUBLIC_URL = 'https://ovp.example.com';

const connectedAppConfig: TableauConfig = {
  enabled: true, serverUrl: 'https://tableau.example.test', siteContentUrl: 'sales',
  clientId: 'connected-app-id', secretId: 'secret-id', secretEnv: 'OVP_TABLEAU_SECRET',
  usernameClaim: 'upn', siteId: '', revision: REVISION, apiVersion: '3.23', authMode: 'connected-app',
};

const oauth2TrustConfig: TableauConfig = {
  enabled: true, serverUrl: 'https://tableau.example.test', siteContentUrl: '',
  clientId: '', secretId: '', secretEnv: '',
  usernameClaim: 'upn', siteId: SITE_ID, revision: REVISION, apiVersion: '3.23', authMode: 'oauth2-trust',
};

/** PUT bodies never carry `revision` — the store assigns it — so strip it from the fixtures above. */
function asInput<T extends { revision: string }>(config: T): Omit<T, 'revision'> {
  const { revision: _revision, ...input } = config;
  return input;
}
const connectedAppInput = asInput(connectedAppConfig);
const oauth2TrustInput = asInput(oauth2TrustConfig);

function decodeSegment(segment: string): unknown {
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
}

function verifyEasJwt(jwt: string, key: TableauEasKey): boolean {
  const [header, payload, signature] = jwt.split('.');
  const publicKey = createPublicKey({ key: key.publicJwk, format: 'jwk' });
  return cryptoVerify('RSA-SHA256', Buffer.from(`${header}.${payload}`, 'utf8'), publicKey, Buffer.from(signature!, 'base64url'));
}

describe('Tableau config: connected-app vs. oauth2-trust', () => {
  it('parses a complete oauth2-trust config and leaves clientId/secretId/secretEnv unused', () => {
    expect(tableauConfigSchema.parse(oauth2TrustConfig)).toEqual(oauth2TrustConfig);
  });

  it('rejects enabled oauth2-trust without a valid site LUID', () => {
    expect(() => tableauConfigSchema.parse({ ...oauth2TrustConfig, siteId: '' })).toThrow();
    expect(() => tableauConfigSchema.parse({ ...oauth2TrustConfig, siteId: 'not-a-uuid' })).toThrow();
    expect(() => tableauConfigInputSchema.parse({ ...oauth2TrustConfig, siteId: '' })).toThrow();
  });

  it('still requires clientId/secretId/secretEnv for enabled connected-app', () => {
    expect(() => tableauConfigSchema.parse({ ...connectedAppConfig, clientId: '' })).toThrow();
    expect(() => tableauConfigSchema.parse({ ...connectedAppConfig, secretEnv: '' })).toThrow();
  });

  it('parses a legacy stored row that predates authMode/siteId, defaulting to connected-app', () => {
    const legacy = { ...connectedAppConfig } as Record<string, unknown>;
    delete legacy.authMode;
    delete legacy.siteId;
    expect(tableauConfigSchema.parse(legacy)).toEqual(connectedAppConfig);
  });

  it('does not change Direct Trust parsing at all', () => {
    expect(tableauConfigSchema.parse(connectedAppConfig)).toEqual(connectedAppConfig);
  });
});

describe('Tableau client: oauth2-trust sign-in', () => {
  const user = (overrides: Partial<TableauSignInUser> = {}): TableauSignInUser => ({
    issuer: 'https://issuer.example.test', sub: 'oidc-user-1', expiresAt: Date.now() + 600_000, claims: { upn: 'alice@example.com' }, ...overrides,
  });

  function response(body: unknown, status = 200) {
    return { status, headers: {}, body: JSON.stringify(body) };
  }

  it('signs the sign-in JWT with RS256 against the EAS key, verifiable via its own JWKS', async () => {
    const key = generateEasKey();
    const issuer = easIssuerUrl(PUBLIC_URL);
    let request: TableauTransportRequest | undefined;
    const transport: TableauTransport = async (value) => {
      request = value;
      return response({ credentials: { token: 'session-token', site: { id: SITE_ID, contentUrl: '' }, user: { id: 'tableau-user', name: 'alice@example.com' } } });
    };
    const client = new TableauClient(oauth2TrustConfig, { transport, eas: { key, issuer } });
    await expect(client.signIn(user())).resolves.toEqual({ token: 'session-token', siteId: SITE_ID, userId: 'tableau-user' });

    const jwt = (JSON.parse(request!.body!) as { credentials: { jwt: string } }).credentials.jwt;
    const [headerSegment, payloadSegment] = jwt.split('.');
    const header = decodeSegment(headerSegment!) as Record<string, unknown>;
    const payload = decodeSegment(payloadSegment!) as Record<string, unknown>;

    // Tableau verifies exactly like this: resolve `kid` in the JWKS, then check the signature.
    expect(header).toEqual({ alg: 'RS256', typ: 'JWT', kid: key.kid });
    expect(verifyEasJwt(jwt, key)).toBe(true);
    expect(payload).toMatchObject({ iss: issuer, sub: 'alice@example.com', aud: `tableau:${SITE_ID}`, scp: ['tableau:content:read'] });
    expect((payload.exp as number) - (payload.iat as number)).toBe(300);

    // A JWT signed by an unrelated key must not verify against this key's JWKS.
    const otherKey = generateEasKey();
    expect(verifyEasJwt(jwt, otherKey)).toBe(false);
  });

  it('throws a clear error when authMode is oauth2-trust but no EAS key was supplied', async () => {
    const client = new TableauClient(oauth2TrustConfig, { transport: async () => response({}) });
    await expect(client.signIn(user())).rejects.toMatchObject({ code: 'TABLEAU_EAS_KEY_MISSING' });
  });

  it('keys the session cache by kid rather than a secret fingerprint', async () => {
    const key = generateEasKey();
    const issuer = easIssuerUrl(PUBLIC_URL);
    let signins = 0;
    const transport: TableauTransport = async (request) => {
      if (request.path.endsWith('/signin')) {
        signins += 1;
        return response({ credentials: { token: `token-${signins}`, site: { id: SITE_ID, contentUrl: '' }, user: { id: 'tableau-user', name: 'alice@example.com' } } });
      }
      return response({}, 204);
    };
    const client = new TableauClient(oauth2TrustConfig, { transport, eas: { key, issuer } });
    await client.signIn(user());
    await client.signIn(user());
    expect(signins).toBe(1);
  });
});

describe('Tableau EAS: public discovery/JWKS route and admin wiring', () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => { cleanups.splice(0).forEach((fn) => fn()); vi.unstubAllEnvs(); });

  function fixture() {
    const db = openSqliteDatabase(':memory:');
    const store = createSqliteTableauStore(db);
    let publicUrl: string | null = PUBLIC_URL;
    let access: TableauAccess = { licensed: true, oidcReady: true, issuer: 'https://idp.example.test', identityRevision: 'v1', publicUrl };
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 }));
    const service = new TableauService(store, async () => access, logger, async () => 'salt');
    cleanups.push(() => { service.stop(); db.close(); });
    const admin = createTableauAdminRoute(service, logger, fetchImpl);
    const eas = createTableauEasRoute(store, async () => publicUrl);
    const request = (method: string, body?: unknown, path = '/') => admin.request(path, {
      method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return {
      store, service, eas, request, fetchImpl,
      setPublicUrl: (next: string | null) => { publicUrl = next; access = { ...access, publicUrl: next }; },
    };
  }

  it('answers 404 for discovery and JWKS while no Tableau integration is configured, and in connected-app mode', async () => {
    const f = fixture();
    expect((await f.eas.request('/.well-known/openid-configuration')).status).toBe(404);
    expect((await f.eas.request('/jwks.json')).status).toBe(404);

    await f.request('PUT', { config: connectedAppInput, expectedRevision: null });
    expect((await f.eas.request('/.well-known/openid-configuration')).status).toBe(404);
    expect((await f.eas.request('/jwks.json')).status).toBe(404);
  });

  it('serves discovery and JWKS once saved with oauth2-trust, matching the persisted key', async () => {
    const f = fixture();
    const putResponse = await f.request('PUT', { config: oauth2TrustInput, expectedRevision: null });
    expect(putResponse.status).toBe(200);
    const stored = await f.store.getEasKey();
    expect(stored).not.toBeNull();

    const discoveryResponse = await f.eas.request('/.well-known/openid-configuration');
    expect(discoveryResponse.status).toBe(200);
    expect(discoveryResponse.headers.get('cache-control')).toBe('public, max-age=300');
    const discovery = await discoveryResponse.json() as { issuer: string; jwks_uri: string };
    expect(discovery.issuer).toBe(easIssuerUrl(PUBLIC_URL));
    expect(discovery.jwks_uri).toBe(`${easIssuerUrl(PUBLIC_URL)}/jwks.json`);

    const jwksResponse = await f.eas.request('/jwks.json');
    expect(jwksResponse.status).toBe(200);
    const jwks = await jwksResponse.json() as { keys: Array<{ kid: string }> };
    expect(jwks.keys).toHaveLength(1);
    expect(jwks.keys[0]!.kid).toBe(stored!.kid);
  });

  it('generates the key for a disabled oauth2-trust draft, and already serves discovery so Tableau can validate the Issuer URL before enablement', async () => {
    const f = fixture();
    const draft = { ...oauth2TrustInput, enabled: false as const };
    const response = await f.request('PUT', { config: draft, expectedRevision: null });
    expect(response.status).toBe(200);
    expect(await f.store.getEasKey()).not.toBeNull();
    // The admin's own `enabled` flag gates OpenVizPilot's Tableau integration, not whether Tableau
    // itself can resolve the Connected App's Issuer URL — Tableau needs to reach discovery/JWKS
    // while the admin is still filling in the "New Connected App" dialog, before flipping `enabled`.
    expect((await f.eas.request('/.well-known/openid-configuration')).status).toBe(200);
  });

  it('rejects enabling oauth2-trust without an HTTPS public URL', async () => {
    const f = fixture();
    f.setPublicUrl(null);
    const response = await f.request('PUT', { config: oauth2TrustInput, expectedRevision: null });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'public_url_required' });
    expect(await f.store.getEasKey()).toBeNull();
  });

  it('never returns the private key from the admin GET, and exposes only issuer/jwks/kid', async () => {
    const f = fixture();
    await f.request('PUT', { config: oauth2TrustInput, expectedRevision: null });
    const getResponse = await f.request('GET');
    const text = await getResponse.text();
    expect(text).not.toContain('privateKeyPem');
    expect(text).not.toContain('BEGIN PRIVATE KEY');
    const body = JSON.parse(text) as { eas: { issuerUrl: string; jwksUrl: string; kid: string; publicUrlOk: boolean } | null };
    expect(body.eas).toEqual({
      issuerUrl: easIssuerUrl(PUBLIC_URL), jwksUrl: `${easIssuerUrl(PUBLIC_URL)}/jwks.json`,
      kid: (await f.store.getEasKey())!.kid, publicUrlOk: true,
    });
  });

  it('runs the configuration self-test against its own discovery URL for oauth2-trust', async () => {
    const f = fixture();
    await f.request('PUT', { config: oauth2TrustInput, expectedRevision: null });
    const checkResponse = await f.request('POST', undefined, '/check');
    expect(checkResponse.status).toBe(200);
    expect(await checkResponse.json()).toMatchObject({ ok: true, stage: 'configuration' });
    expect(f.fetchImpl).toHaveBeenCalledWith(`${easIssuerUrl(PUBLIC_URL)}/.well-known/openid-configuration`, expect.anything());
  });

  it('fails the self-test when the discovery URL is not reachable from the middleware itself', async () => {
    const f = fixture();
    await f.request('PUT', { config: oauth2TrustInput, expectedRevision: null });
    f.fetchImpl.mockRejectedValueOnce(new Error('network unreachable'));
    const checkResponse = await f.request('POST', undefined, '/check');
    expect(checkResponse.status).toBe(400);
    expect(await checkResponse.json()).toMatchObject({ code: 'eas_discovery_unreachable' });
  });

  it('keeps EAS_PATH stable as the public mount point', () => {
    expect(EAS_PATH).toBe('/tableau-eas');
  });
});
