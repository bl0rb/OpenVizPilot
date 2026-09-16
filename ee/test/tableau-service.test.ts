import { afterEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { openSqliteDatabase } from '../../packages/server/src/memory/sqlite-store';
import type { AuthVariables } from '../server/src/auth-routes';
import { createSqliteTableauStore, createPgTableauStore } from '../server/src/tableau-server/store';
import { TableauService, type TableauAccess } from '../server/src/tableau-server/service';
import { createTableauAdminRoute, createTableauRoute } from '../server/src/tableau-server/routes';
import { TableauError } from '../server/src/tableau-server/errors';

const input = {
  enabled: true, serverUrl: 'https://tableau.example.com', siteContentUrl: 'sales',
  clientId: 'client', secretId: 'secret-id', secretEnv: 'OVP_TABLEAU_TEST_SECRET',
  usernameClaim: 'upn', siteId: '', apiVersion: '3.23' as const, authMode: 'connected-app' as const,
};
const user = { issuer: 'https://idp.example.com', sub: 'oidc-user', expiresAt: Date.now() + 3600_000, claims: { upn: 'TableauUser' } };
const cleanups: Array<() => void> = [];
afterEach(() => { cleanups.splice(0).forEach((fn) => fn()); vi.unstubAllEnvs(); });

async function fixture() {
  vi.stubEnv('OVP_TABLEAU_TEST_SECRET', 'sentinel-tableau-secret');
  const db = openSqliteDatabase(':memory:');
  const store = createSqliteTableauStore(db);
  let access: TableauAccess = { licensed: true, oidcReady: true, issuer: user.issuer, identityRevision: 'oidc-v1', publicUrl: 'https://ovp.example.com' };
  let readGate: Promise<void> | null = null;
  const clients: Array<{ signIn: ReturnType<typeof vi.fn>; clear: ReturnType<typeof vi.fn>; clearUser: ReturnType<typeof vi.fn>; prune: ReturnType<typeof vi.fn>; read: ReturnType<typeof vi.fn> }> = [];
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const service = new TableauService(store, async () => access, logger, async () => 'audit-salt', () => {
    const emptyContent = (resource: string, key: string, pageSize: number) => ({
      [resource]: {
        [key]: [],
      },
      pagination: { pageNumber: 1, pageSize, totalAvailable: 0 },
    });
    const client = {
      signIn: vi.fn(async () => ({ token: 'sentinel-session', siteId: 'site-id', userId: 'user-id' })),
      clear: vi.fn(async () => {}),
      clearUser: vi.fn(async () => {}),
      prune: vi.fn(async () => {}),
      queryMetadata: vi.fn(async () => ({})),
      read: vi.fn(async (_user: unknown, resource: string, query?: { pageSize?: number }) => {
        if (readGate) await readGate;
        if (resource === 'serverinfo') return {
          serverInfo: { productVersion: { value: '2025.3' }, restApiVersion: '3.27' },
        };
        return resource === 'workbooks'
          ? emptyContent('workbooks', 'workbook', query?.pageSize ?? 100)
          : resource === 'views'
            ? emptyContent('views', 'view', query?.pageSize ?? 100)
            : resource === 'projects'
              ? emptyContent('projects', 'project', query?.pageSize ?? 100)
              : emptyContent('datasources', 'datasource', query?.pageSize ?? 100);
      }),
    };
    clients.push(client);
    return client;
  });
  cleanups.push(() => { service.stop(); db.close(); });
  const admin = createTableauAdminRoute(service, logger);
  const request = (method: string, body?: unknown, path = '/') => admin.request(path, {
    method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return {
    store, service, admin, request, clients, logger,
    setAccess: (next: Partial<TableauAccess>) => { access = { ...access, ...next }; },
    setReadGate: (gate: Promise<void> | null) => { readGate = gate; },
  };
}

describe('Tableau persistence and administration', () => {
  it('persists references, prevents concurrent writes and retains a revision after reset', async () => {
    const f = await fixture();
    expect(await f.store.get()).toEqual({ config: null, revision: null });
    expect(await f.store.set(input, null)).toBe(true);
    const first = await f.store.get();
    expect(first.config).toMatchObject(input);
    expect(await f.store.set({ ...input, siteContentUrl: 'other' }, null)).toBe(false);
    expect(await f.store.set(null, first.revision)).toBe(true);
    const reset = await f.store.get();
    expect(reset.config).toBeNull();
    expect(reset.revision).not.toBe(first.revision);
    expect(await f.store.set(input, null)).toBe(false);
    expect(await f.store.set(input, reset.revision)).toBe(true);
  });

  it('returns presence only, rejects raw secrets, and performs no sign-in for an admin check', async () => {
    const f = await fixture();
    const response = await f.request('PUT', { config: input, expectedRevision: null });
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain('"secretConfigured":true');
    expect(text).not.toContain('sentinel-tableau-secret');
    expect((await f.request('PUT', { config: { ...input, secretValue: 'sentinel' }, expectedRevision: null })).status).toBe(400);
    expect((await f.request('POST', undefined, '/check')).status).toBe(200);
    expect(f.clients).toHaveLength(0);
  });

  it('requires both gates for activation but permits disabling and deleting after license loss', async () => {
    const f = await fixture();
    f.setAccess({ licensed: false });
    expect((await f.request('PUT', { config: input, expectedRevision: null })).status).toBe(402);
    f.setAccess({ licensed: true, oidcReady: false });
    expect((await f.request('PUT', { config: input, expectedRevision: null })).status).toBe(403);
    f.setAccess({ licensed: false });
    expect((await f.request('PUT', { config: { ...input, enabled: false }, expectedRevision: null })).status).toBe(200);
    const { revision } = await f.store.get();
    expect((await f.request('DELETE', { expectedRevision: revision })).status).toBe(200);
    expect((await f.request('PUT', { config: { ...input, enabled: false }, expectedRevision: revision })).status).toBe(409);
  });

  it('fails closed on malformed requests and unavailable secret references', async () => {
    const f = await fixture();
    expect((await f.request('PUT', { config: { ...input, secretEnv: 'LITELLM_API_KEY' }, expectedRevision: null })).status).toBe(400);
    vi.stubEnv('OVP_TABLEAU_TEST_SECRET', '');
    expect((await f.request('PUT', { config: input, expectedRevision: null })).status).toBe(400);
    expect((await f.request('DELETE', {})).status).toBe(400);
  });

  it('uses a parameterized atomic PostgreSQL revision update', async () => {
    const query = vi.fn(async (_sql: string, _params?: unknown[]) => ({ rows: [], rowCount: 1 }));
    const store = createPgTableauStore({ query, connect: async () => ({ query, release() {} }) });
    expect(await store.set(input, null)).toBe(true);
    const [sql, params] = query.mock.calls[1]!;
    expect(sql).toContain('IS NOT DISTINCT FROM $3');
    expect(params?.[2]).toBeNull();
    expect(JSON.parse(params?.[0] as string)).toMatchObject(input);
  });
});

describe('Tableau user access lifecycle', () => {
  it('checks a verified user without exposing credentials and replaces clients on config changes', async () => {
    const f = await fixture();
    await f.store.set(input, null);
    expect(await f.service.check(user)).toEqual({ ok: true, stage: 'authentication' });
    await f.service.check(user);
    expect(f.clients).toHaveLength(1);
    await f.store.set({ ...input, siteContentUrl: 'other' }, (await f.store.get()).revision);
    await f.service.check(user);
    expect(f.clients).toHaveLength(2);
    expect(f.clients[0]!.clear).toHaveBeenCalled();
    const logs = JSON.stringify(f.logger.info.mock.calls);
    for (const secret of ['sentinel-session', 'sentinel-tableau-secret', 'TableauUser', 'oidc-user']) expect(logs).not.toContain(secret);
    await f.service.logout(user);
    expect(f.clients[1]!.clearUser).toHaveBeenCalledWith(user.issuer, user.sub);
  });

  it('denies disabled, unlicensed, non-OIDC, foreign issuer and expired user sessions', async () => {
    const f = await fixture();
    await expect(f.service.check(user)).rejects.toMatchObject({ code: 'tableau_disabled' });
    await f.store.set(input, null);
    f.setAccess({ licensed: false });
    await expect(f.service.check(user)).rejects.toMatchObject({ code: 'license_required' });
    f.setAccess({ licensed: true, oidcReady: false });
    await expect(f.service.check(user)).rejects.toMatchObject({ code: 'oidc_required' });
    f.setAccess({ oidcReady: true });
    await expect(f.service.check({ ...user, issuer: 'other' })).rejects.toMatchObject({ code: 'oidc_required' });
    await expect(f.service.check({ ...user, expiresAt: 1 })).rejects.toMatchObject({ code: 'oidc_required' });
    expect(f.clients).toHaveLength(0);
  });

  it('reports availability without signing in or making a Tableau network request', async () => {
    const f = await fixture();
    expect(await f.service.available(undefined)).toBe(false);
    expect(f.clients).toHaveLength(0);
    await f.store.set(input, null);
    expect(await f.service.available(user)).toBe(true);
    expect(f.clients).toHaveLength(0);
    f.setAccess({ licensed: false });
    expect(await f.service.available(user)).toBe(false);
    f.setAccess({ licensed: true });
    expect(await f.service.available({ ...user, claims: {} })).toBe(false);
    expect(f.clients).toHaveLength(0);
  });

  it('discards a successful sign-in when configuration changes during the request', async () => {
    const f = await fixture();
    await f.store.set(input, null);
    await f.service.check(user);
    f.clients[0]!.signIn.mockImplementationOnce(async () => {
      await f.store.set(null, (await f.store.get()).revision);
      return { token: 'discard', siteId: 'site', userId: 'user' };
    });
    await expect(f.service.check(user)).rejects.toBeDefined();
    expect(f.clients[0]!.clear).toHaveBeenCalled();
  });

  it('runs a personal connection check and never trusts a username in the request body', async () => {
    const f = await fixture();
    await f.store.set(input, null);
    const anonymous = createTableauRoute(f.service);
    expect((await anonymous.request('/check', { method: 'POST', body: JSON.stringify({ username: 'admin' }) })).status).toBe(403);
    const app = new Hono<AuthVariables>();
    app.use('*', async (c, next) => { c.set('oidcUser', user); await next(); });
    app.route('/', createTableauRoute(f.service));
    const response = await app.request('/check', { method: 'POST' });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, stage: 'connection', serverVersion: '2025.3', apiVersion: '3.27' });
    expect(f.clients[0]!.read).toHaveBeenCalledWith(user, 'serverinfo', undefined, expect.any(AbortSignal));
  });

  it('rejects unknown search arguments before reading Tableau content', async () => {
    const f = await fixture();
    await f.store.set(input, null);
    const app = new Hono<AuthVariables>();
    app.use('*', async (c, next) => { c.set('oidcUser', user); await next(); });
    app.route('/', createTableauRoute(f.service));
    const response = await app.request('/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: 'sales', username: 'admin' }),
    });
    expect(response.status).toBe(400);
    expect(f.clients).toHaveLength(0);
    const valid = await app.request('/search', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(valid.status).toBe(200);
    expect(await valid.json()).toMatchObject({ source: 'Tableau Server', items: [], truncated: false, scanned: 0 });
  });

  it('names the required Tableau version when the server does not serve the fixed REST version', async () => {
    const service = { search: vi.fn(async () => { throw new TableauError('TABLEAU_VERSION_UNSUPPORTED', 404); }) };
    const app = new Hono<AuthVariables>();
    app.use('*', async (c, next) => { c.set('oidcUser', user); await next(); });
    app.route('/', createTableauRoute(service as never));
    const response = await app.request('/search', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: 'Tableau Server unterstützt REST API 3.23 nicht; mindestens Tableau Server 2024.2 erforderlich.', code: 'TABLEAU_VERSION_UNSUPPORTED' });
  });

  it('discards a search when configuration is revoked during a read', async () => {
    const f = await fixture();
    await f.store.set(input, null);
    let release!: () => void;
    const paused = new Promise<void>((resolve) => { release = resolve; });
    f.setReadGate(paused);
    const pending = f.service.search(user, { query: 'sales' });
    await vi.waitFor(() => expect(f.clients[0]?.read).toHaveBeenCalled());
    await f.store.set(null, (await f.store.get()).revision);
    release();
    await expect(pending).rejects.toBeDefined();
    expect(f.clients[0]!.clear).toHaveBeenCalled();
  });

  it('discards a search when the license is revoked during a read', async () => {
    const f = await fixture();
    await f.store.set(input, null);
    let release!: () => void;
    const paused = new Promise<void>((resolve) => { release = resolve; });
    f.setReadGate(paused);
    const pending = f.service.search(user, { query: 'sales' });
    await vi.waitFor(() => expect(f.clients[0]?.read).toHaveBeenCalled());
    f.setAccess({ licensed: false });
    release();
    await expect(pending).rejects.toBeDefined();
    expect(f.clients[0]!.clear).toHaveBeenCalled();
  });
});
