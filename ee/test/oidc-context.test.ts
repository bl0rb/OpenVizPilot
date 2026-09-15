import { generateKeyPairSync, sign } from 'node:crypto';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { requireOidcUser, type AuthVariables } from '../server/src/auth-routes';
import { OidcClient } from '../server/src/oidc';

describe('requireOidcUser verified context', () => {
  it('stores verified issuer and claims while keeping the exchange user payload narrow', async () => {
    const issuer = 'https://issuer.example.test';
    const clientId = 'client-1';
    const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const jwk = publicKey.export({ format: 'jwk' }) as { n: string; e: string };
    const now = Math.floor(Date.now() / 1000);
    const payload = { iss: issuer, aud: clientId, sub: 'user-7', exp: now + 600, iat: now, tableau_username: 'alice' };
    const b64 = (value: string) => Buffer.from(value).toString('base64url');
    const header = b64(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'key-1' }));
    const body = b64(JSON.stringify(payload));
    const token = `${header}.${body}.${sign('RSA-SHA256', Buffer.from(`${header}.${body}`), privateKey).toString('base64url')}`;
    const fetchMock: typeof fetch = async (input) => {
      const url = String(input);
      if (url.endsWith('/.well-known/openid-configuration')) {
        return Response.json({ issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/jwks` });
      }
      if (url.endsWith('/jwks')) return Response.json({ keys: [{ kty: 'RSA', kid: 'key-1', alg: 'RS256', use: 'sig', n: jwk.n, e: jwk.e }] });
      throw new Error(`unexpected fetch: ${url}`);
    };
    const oidc = new OidcClient({ issuer, clientId, scopes: 'openid', provider: 'generic' }, fetchMock);
    const app = new Hono<AuthVariables>();
    app.use('*', requireOidcUser(oidc, () => {}));
    app.get('/', (c) => {
      const user = c.get('oidcUser');
      return c.json({ authUser: c.get('authUser'), issuer: user?.issuer, claims: user?.claims });
    });

    const res = await app.request('/', { headers: { authorization: `Bearer ${token}` } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ authUser: 'user-7', issuer, claims: payload });
  });
});
