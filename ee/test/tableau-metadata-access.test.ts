import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openSqliteDatabase } from '../../packages/server/src/memory/sqlite-store';
import type { AuthVariables } from '../server/src/auth-routes';
import { createSqliteTableauStore } from '../server/src/tableau-server/store';
import { TableauService, type TableauAccess } from '../server/src/tableau-server/service';
import { createTableauRoute } from '../server/src/tableau-server/routes';

const user = { issuer: 'https://idp.example.test', sub: 'alice', expiresAt: Date.now() + 3600_000, claims: { upn: 'Alice' } };
const cleanups: Array<() => void> = [];
afterEach(() => { cleanups.splice(0).forEach(fn => fn()); vi.unstubAllEnvs(); });

async function setup() {
  vi.stubEnv('OVP_TABLEAU_TEST', 'private-secret');
  const db = openSqliteDatabase(':memory:');
  const store = createSqliteTableauStore(db);
  await store.set({ enabled: true, serverUrl: 'https://tableau.example.test', siteContentUrl: 'sales', clientId: 'client', secretId: 'secret-id', secretEnv: 'OVP_TABLEAU_TEST', usernameClaim: 'upn', apiVersion: '3.27', authMode: 'connected-app' }, null);
  const access: TableauAccess = { licensed: true, oidcReady: true, issuer: user.issuer, identityRevision: 'oidc-1' };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const empty = { data: { fieldsConnection: { nodes: [], totalCount: 0, pageInfo: { hasNextPage: false, endCursor: null } } } };
  const client = { signIn: vi.fn(), read: vi.fn(), clear: vi.fn(async () => {}), clearUser: vi.fn(async () => {}), prune: vi.fn(async () => {}), queryMetadata: vi.fn(async (_user: typeof user, _document: string, _variables: Record<string, unknown>, _signal?: AbortSignal) => empty) };
  const service = new TableauService(store, async () => access, logger, async () => 'salt', () => client);
  cleanups.push(() => { service.stop(); db.close(); });
  const app = new Hono<AuthVariables>();
  app.use('*', async (c, next) => { c.set('oidcUser', user); await next(); });
  app.route('/', createTableauRoute(service));
  const request = (path: string, body: unknown) => app.request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { service, access, client, store, logger, request };
}

describe('Tableau Metadata API access boundaries', () => {
  it('accepts only the named metadata arguments and never a raw GraphQL proxy', async () => {
    const f = await setup();
    for (const [path, body] of [
      ['/metadata/search', { query: 'Sales', username: 'admin' }],
      ['/metadata/search', { document: 'query { users { name } }' }],
      ['/metadata/field', { fieldId: 'f1', variables: {} }],
      ['/metadata/field', { fieldId: '' }],
    ] as const) expect((await f.request(path, body)).status).toBe(400);
    expect(f.client.queryMetadata).not.toHaveBeenCalled();
    const response = await f.request('/metadata/search', { query: 'sales' });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toMatchObject({ source: 'Tableau Metadata API', items: [] });
    expect(f.client.queryMetadata.mock.calls[0]?.[0]).toEqual(user);
  });

  it('gates metadata on the existing license, OIDC and exact user claim', async () => {
    const f = await setup();
    f.access.licensed = false;
    expect((await f.request('/metadata/search', {})).status).toBe(402);
    f.access.licensed = true;
    f.access.oidcReady = false;
    expect((await f.request('/metadata/search', {})).status).toBe(403);
    f.access.oidcReady = true;
    await expect(f.service.metadataSearch({ ...user, claims: {} }, {})).rejects.toMatchObject({ code: 'TABLEAU_CLAIM_INVALID' });
    expect(f.client.queryMetadata).not.toHaveBeenCalled();
  });

  it('discards a metadata response if the license or configuration changes during the query', async () => {
    for (const change of ['license', 'config']) {
      const f = await setup();
      const original = f.client.queryMetadata.getMockImplementation()!;
      f.client.queryMetadata.mockImplementationOnce(async () => {
        if (change === 'license') f.access.licensed = false;
        else await f.store.set(null, (await f.store.get()).revision);
        return original(user, '', {});
      });
      await expect(f.service.metadataSearch(user, {})).rejects.toBeDefined();
      expect(f.client.clear).toHaveBeenCalled();
    }
  });

  it('does not disclose GraphQL partial data or upstream error messages', async () => {
    const f = await setup();
    f.client.queryMetadata.mockResolvedValueOnce({
      data: { fieldsConnection: { nodes: [{ id: 'private-id', name: 'private-field' }], pageInfo: { hasNextPage: false, endCursor: null } } },
      errors: [{ message: 'private-secret upstream diagnostic' }],
    } as never);
    const response = await f.request('/metadata/search', {});
    expect(response.status).toBe(502);
    const text = await response.text();
    expect(text).not.toContain('private-');
    expect(JSON.stringify(f.logger.warn.mock.calls)).not.toContain('private-');
  });

  it('shares the eight-operation concurrency limit and releases slots after completion', async () => {
    const f = await setup();
    const original = f.client.queryMetadata.getMockImplementation()!;
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    f.client.queryMetadata.mockImplementation(async (...args) => { await gate; return original(...args); });
    const pending = Array.from({ length: 8 }, () => f.service.metadataSearch(user, {}));
    try {
      await vi.waitFor(() => expect(f.client.queryMetadata).toHaveBeenCalledTimes(8));
      const denied = await f.request('/metadata/search', {});
      expect(denied.status).toBe(429);
      expect(denied.headers.get('retry-after')).toBe('1');
    } finally {
      release();
      await Promise.all(pending);
    }
    expect((await f.request('/metadata/search', {})).status).toBe(200);
  });
});
