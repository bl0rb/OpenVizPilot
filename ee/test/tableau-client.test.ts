import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { resolveTableauSecret, tableauConfigInputSchema, tableauConfigSchema, type TableauConfig } from '../server/src/tableau-server/config';
import { TableauClient } from '../server/src/tableau-server/client';
import type { TableauTransport, TableauTransportRequest } from '../server/src/tableau-server/http';

const now = 1_750_000_000_000;
const config: TableauConfig = {
  enabled: true,
  serverUrl: 'https://tableau.example.test',
  siteContentUrl: 'sales',
  clientId: 'connected-app-id',
  secretId: 'secret-id',
  secretEnv: 'OVP_TABLEAU_SECRET',
  usernameClaim: 'tableau_username',
  revision: '11111111-1111-4111-8111-111111111111',
  apiVersion: '3.23',
  authMode: 'connected-app',
};
const user = (overrides: Partial<{ issuer: string; sub: string; expiresAt: number; claims: Readonly<Record<string, unknown>> }> = {}) => ({
  issuer: 'https://issuer.example.test',
  sub: 'oidc-user-1',
  expiresAt: now + 600_000,
  claims: { tableau_username: 'alice' },
  ...overrides,
});

function response(body: unknown, status = 200) {
  return { status, headers: {}, body: JSON.stringify(body) };
}

function signinResponse(token = 'credentials-token', siteContentUrl = 'sales', username = 'alice') {
  return response({ credentials: { token, site: { id: 'site-luid', contentUrl: siteContentUrl }, user: { id: 'tableau-user', name: username } } });
}

describe('Tableau Phase 1 primitives', () => {
  it('validates complete config and permits incomplete disabled input', () => {
    expect(tableauConfigSchema.parse(config)).toEqual(config);
    expect(tableauConfigSchema.parse({ ...config, apiVersion: '3.27' })).toEqual(config);
    expect(() => tableauConfigSchema.parse({ ...config, apiVersion: '3.22' })).toThrow();
    expect(tableauConfigInputSchema.parse({ enabled: false })).toEqual({
      enabled: false, serverUrl: '', siteContentUrl: '', clientId: '', secretId: '', secretEnv: '', usernameClaim: '', apiVersion: '3.23', authMode: 'connected-app',
    });
    expect(tableauConfigSchema.parse({ enabled: false, revision: config.revision })).toMatchObject({ enabled: false, serverUrl: '', secretEnv: '' });
    expect(() => tableauConfigInputSchema.parse({ enabled: true, serverUrl: config.serverUrl })).toThrow();
    expect(() => tableauConfigSchema.parse({ ...config, serverUrl: 'http://tableau.example.test' })).toThrow();
    expect(() => tableauConfigSchema.parse({ ...config, secretEnv: 'OVP_OTHER_SECRET' })).toThrow();
    expect(() => tableauConfigInputSchema.parse({ enabled: false, secretValue: 'sentinel' })).toThrow();
    expect(resolveTableauSecret(config, { OVP_TABLEAU_SECRET: 'sentinel-secret' })).toBe('sentinel-secret');
    expect(() => resolveTableauSecret({ secretEnv: 'LITELLM_API_KEY' }, { LITELLM_API_KEY: 'secret' })).toThrow();
  });

  it('signs the exact mapped username and returns the REST sign-in mapping', async () => {
    let request: TableauTransportRequest | undefined;
    const transport: TableauTransport = async (value) => {
      request = value;
      return signinResponse();
    };
    const client = new TableauClient(config, { env: { OVP_TABLEAU_SECRET: 'sentinel-secret' }, transport, time: () => now });
    await expect(client.signIn(user())).resolves.toEqual({ token: 'credentials-token', siteId: 'site-luid', userId: 'tableau-user' });
    const jwt = (JSON.parse(request!.body!) as { credentials: { jwt: string } }).credentials.jwt;
    const [encodedHeader, encodedPayload, signature] = jwt.split('.');
    const payload = JSON.parse(Buffer.from(encodedPayload!, 'base64url').toString('utf8')) as Record<string, unknown>;
    const header = JSON.parse(Buffer.from(encodedHeader!, 'base64url').toString('utf8')) as Record<string, unknown>;
    expect(header).toMatchObject({ alg: 'HS256', kid: 'secret-id', iss: 'connected-app-id' });
    expect(payload).toMatchObject({ iss: 'connected-app-id', sub: 'alice', aud: 'tableau', exp: 1_750_000_060, scp: ['tableau:content:read'] });
    expect(typeof payload.jti).toBe('string');
    expect(signature).toBe(createHmac('sha256', 'sentinel-secret').update(jwt.split('.').slice(0, 2).join('.')).digest('base64url'));
    expect(request!.path).toBe('/api/3.23/auth/signin');
    expect(JSON.parse(request!.body!)).toMatchObject({ credentials: { site: { contentUrl: 'sales' } } });
  });

  it('rejects unmapped claims, wrong sites, and auth failures without contacting fallback identities', async () => {
    let calls = 0;
    const transport: TableauTransport = async () => { calls += 1; return signinResponse('token', 'other-site'); };
    const client = new TableauClient(config, { env: { OVP_TABLEAU_SECRET: 'secret' }, transport, time: () => now });
    await expect(client.signIn(user({ claims: { tableau_username: '   ' } }))).rejects.toMatchObject({ code: 'TABLEAU_CLAIM_INVALID' });
    await expect(client.signIn(user())).rejects.toMatchObject({ code: 'TABLEAU_WRONG_SITE' });
    expect(calls).toBe(2);

    const failed = new TableauClient(config, { env: { OVP_TABLEAU_SECRET: 'secret' }, transport: async () => response({}, 401), time: () => now });
    await expect(failed.signIn(user())).rejects.toMatchObject({ code: 'TABLEAU_AUTH_FAILED', status: 401 });
  });

  it('accepts Tableau standard sign-in responses that return only user.id', async () => {
    const client = new TableauClient(config, {
      env: { OVP_TABLEAU_SECRET: 'secret' },
      transport: async () => response({ credentials: { token: 'token', site: { id: 'site-luid', contentUrl: 'sales' }, user: { id: 'tableau-user' } } }),
      time: () => now,
    });
    await expect(client.signIn(user())).resolves.toEqual({ token: 'token', siteId: 'site-luid', userId: 'tableau-user' });
  });

  it('isolates cache entries and invalidates them on user and global clear', async () => {
    const requests: TableauTransportRequest[] = [];
    const transport: TableauTransport = async (request) => {
      requests.push(request);
      if (request.path.endsWith('signout')) return response({}, 204);
      const body = JSON.parse(request.body!) as { credentials: { jwt: string } };
      const payload = JSON.parse(Buffer.from(body.credentials.jwt.split('.')[1]!, 'base64url').toString('utf8')) as { sub: string };
      return signinResponse(`${payload.sub}-token`, 'sales', payload.sub);
    };
    const client = new TableauClient(config, { env: { OVP_TABLEAU_SECRET: 'secret' }, transport, time: () => now });
    const bob = user({ sub: 'oidc-user-2', claims: { tableau_username: 'bob' } });
    await client.signIn(user());
    await client.signIn(user());
    await client.signIn(bob);
    expect(requests.filter((entry) => entry.path.endsWith('signin'))).toHaveLength(2);
    await client.clearUser(user().issuer, user().sub);
    await client.signIn(user());
    expect(requests.filter((entry) => entry.path.endsWith('signin'))).toHaveLength(3);
    await client.clear();
    expect(requests.filter((entry) => entry.path.endsWith('signout'))).toHaveLength(3);
  });

});
