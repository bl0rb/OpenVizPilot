import { afterEach, describe, expect, it, vi } from 'vitest';
import { TableauClient, type TableauSignInUser } from '../server/src/tableau-server/client';
import type { TableauConfig } from '../server/src/tableau-server/config';
import type { TableauTransport, TableauTransportRequest } from '../server/src/tableau-server/http';
import { METADATA_SEARCH_QUERY } from '../server/src/tableau-server/metadata-queries';

const config = {
  enabled: true, serverUrl: 'https://tableau.example.test', siteContentUrl: 'sales',
  clientId: 'client', secretId: 'secret-id', secretEnv: 'OVP_TABLEAU_TEST', usernameClaim: 'upn', siteId: '',
  revision: '11111111-1111-4111-8111-111111111111', apiVersion: '3.23', authMode: 'connected-app',
} satisfies TableauConfig;
const user: TableauSignInUser = { issuer: 'https://idp.example.test', sub: 'alice', expiresAt: Date.now() + 3600_000, claims: { upn: 'alice' } };
const response = (body: unknown, status = 200, headers = {}) => ({ status, headers, body: JSON.stringify(body) });
const signin = (token: string) => response({ credentials: { token, site: { id: 'site-luid', contentUrl: 'sales' }, user: { id: 'alice-luid' } } });
const clientFor = (transport: TableauTransport) => new TableauClient(config, { env: { OVP_TABLEAU_TEST: 'secret-sentinel' }, transport });
afterEach(() => vi.useRealTimers());

describe('Tableau authenticated Metadata API transport', () => {
  it('shares the personal content session and sends variables separately to the fixed endpoint', async () => {
    const requests: TableauTransportRequest[] = [];
    const client = clientFor(async request => {
      requests.push(request);
      return request.path.endsWith('/signin') ? signin('alice-token') : response({ data: {} });
    });
    await client.signIn(user);
    const variables = { query: 'a" } mutation { secret }', first: 20 };
    await client.queryMetadata(user, METADATA_SEARCH_QUERY, variables);
    expect(requests).toHaveLength(2);
    expect(requests[1]).toMatchObject({ method: 'POST', path: '/api/metadata/graphql', headers: { 'x-tableau-auth': 'alice-token' } });
    expect(JSON.parse(requests[1]!.body!)).toEqual({ query: METADATA_SEARCH_QUERY, variables });
    expect(requests[1]!.body).not.toContain('secret-sentinel');
    const jwt = JSON.parse(requests[0]!.body!).credentials.jwt;
    expect(JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString()).scp).toEqual(['tableau:content:read']);
  });

  it('rejects arbitrary GraphQL documents before sign-in', async () => {
    const transport = vi.fn();
    const client = clientFor(transport);
    for (const document of ['mutation { deleteAll }', 'query { users { name } }', METADATA_SEARCH_QUERY + ' ']) {
      await expect(client.queryMetadata(user, document, {})).rejects.toMatchObject({ code: 'TABLEAU_QUERY_INVALID' });
    }
    expect(transport).not.toHaveBeenCalled();
  });

  it('reauthenticates once for 401 but never switches user or retries 403', async () => {
    let signins = 0;
    let reads = 0;
    const headers: string[] = [];
    const client = clientFor(async request => {
      if (request.path.endsWith('/signin')) return signin(`alice-${++signins}`);
      if (request.path.endsWith('/signout')) return response({}, 204);
      headers.push(request.headers['x-tableau-auth']!);
      return ++reads === 1 ? response({}, 401) : reads === 2 ? response({ data: {} }) : response({ raw: 'private-error' }, 403);
    });
    await client.queryMetadata(user, METADATA_SEARCH_QUERY, {});
    expect(headers).toEqual(['alice-1', 'alice-2']);
    await expect(client.queryMetadata(user, METADATA_SEARCH_QUERY, {})).rejects.toMatchObject({ code: 'TABLEAU_HTTP_ERROR', status: 403 });
    expect(reads).toBe(3);
    expect(signins).toBe(2);
  });

  it('does not release an in-flight Metadata response after logout', async () => {
    let release!: (value: ReturnType<typeof response>) => void;
    const client = clientFor(async request => {
      if (request.path.endsWith('/signin')) return signin('alice-token');
      if (request.path.endsWith('/signout')) return response({}, 204);
      return new Promise(resolve => { release = resolve; });
    });
    const pending = client.queryMetadata(user, METADATA_SEARCH_QUERY, {});
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    await client.clearUser(user.issuer, user.sub);
    release(response({ data: { sensitive: 'must-not-return' } }));
    await expect(pending).rejects.toMatchObject({ code: 'TABLEAU_SIGNIN_INVALIDATED' });
  });

  it('honors cancellation without sending a request', async () => {
    const transport = vi.fn();
    const client = clientFor(transport);
    await expect(client.queryMetadata(user, METADATA_SEARCH_QUERY, {}, AbortSignal.abort())).rejects.toMatchObject({ code: 'TABLEAU_ABORTED' });
    expect(transport).not.toHaveBeenCalled();
  });
});
