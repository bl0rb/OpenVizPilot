import { describe, expect, it } from 'vitest';
import { TableauClient } from '../server/src/tableau-server/client';
import { tableauConfigSchema } from '../server/src/tableau-server/config';
import type { TableauTransportRequest } from '../server/src/tableau-server/http';

const config = tableauConfigSchema.parse({ enabled: true, serverUrl: 'https://tableau.example.com', siteContentUrl: '',
  clientId: 'app', secretId: 'key', secretEnv: 'OVP_TABLEAU_SECRET', usernameClaim: 'upn',
  revision: '11111111-1111-4111-8111-111111111111', apiVersion: '3.23', authMode: 'connected-app' });
const epoch = 1_750_000_000_000;
const identity = { issuer: 'https://idp.example.com', sub: 'user', expiresAt: epoch + 600_000, claims: { upn: 'DOMAIN\\Alice' } };
const result = { status: 200, headers: {}, body: JSON.stringify({ credentials: { token: 'session', site: { id: 'default', contentUrl: '' }, user: { id: 'alice-id' } } }) };

describe('Tableau authentication lifecycle', () => {
  it('accepts the standard id-only response and expires cached credentials after five minutes', async () => {
    let now = epoch;
    const requests: TableauTransportRequest[] = [];
    const client = new TableauClient(config, { env: { OVP_TABLEAU_SECRET: 'secret' }, now: () => now, transport: async (r) => { requests.push(r); return result; } });
    await client.signIn(identity);
    const jwt = JSON.parse(requests[0]!.body!).credentials.jwt;
    expect(JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString()).sub).toBe('DOMAIN\\Alice');
    now += 299_000;
    await client.signIn(identity);
    expect(requests.filter(r => r.path.endsWith('signin'))).toHaveLength(1);
    now += 1_001;
    await client.prune();
    expect(requests.filter(r => r.path.endsWith('signout'))).toHaveLength(1);
    await client.signIn(identity);
    expect(requests.filter(r => r.path.endsWith('signin'))).toHaveLength(2);
    const jwt2 = JSON.parse(requests.at(-1)!.body!).credentials.jwt;
    expect(JSON.parse(Buffer.from(jwt2.split('.')[1], 'base64url').toString()).jti)
      .not.toBe(JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString()).jti);
    await client.clear();
  });

  it('never serves expired identities, including when they expire during sign-in', async () => {
    let now = epoch;
    const calls: string[] = [];
    const client = new TableauClient(config, { env: { OVP_TABLEAU_SECRET: 'secret' }, now: () => now, transport: async (r) => {
      calls.push(r.path); now = identity.expiresAt; return result;
    } });
    await expect(client.signIn({ ...identity, expiresAt: epoch })).rejects.toMatchObject({ code: 'TABLEAU_IDENTITY_EXPIRED' });
    expect(calls).toHaveLength(0);
    await expect(client.signIn(identity)).rejects.toMatchObject({ code: 'TABLEAU_IDENTITY_EXPIRED' });
    expect(calls).toEqual(['/api/3.23/auth/signin', '/api/3.23/auth/signout']);
  });

  it.each(['global', 'user'])('invalidates a pending sign-in on %s clear', async (scope) => {
    let resolve!: (value: typeof result) => void;
    const pending = new Promise<typeof result>(r => { resolve = r; });
    const paths: string[] = [];
    const client = new TableauClient(config, { env: { OVP_TABLEAU_SECRET: 'secret' }, now: () => epoch, transport: async (r) => {
      paths.push(r.path); return r.path.endsWith('signin') ? pending : result;
    } });
    const operation = client.signIn(identity);
    const rejected = expect(operation).rejects.toMatchObject({ code: 'TABLEAU_SIGNIN_INVALIDATED' });
    if (scope === 'global') await client.clear();
    else await client.clearUser(identity.issuer, identity.sub);
    resolve(result);
    await rejected;
    expect(paths).toContain('/api/3.23/auth/signout');
  });
});
