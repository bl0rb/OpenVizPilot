import { describe, expect, it, vi } from 'vitest';
import { TableauClient, type TableauSignInUser } from '../server/src/tableau-server/client';
import { TableauError } from '../server/src/tableau-server/errors';
import type { TableauConfig } from '../server/src/tableau-server/config';
import type { TableauTransport, TableauTransportRequest, TableauTransportResponse } from '../server/src/tableau-server/http';
import { TableauRest } from '../server/src/tableau-server/rest';
import { tableauSearchSchema, type TableauContent } from '../server/src/tableau-server/schema';

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
const user: TableauSignInUser = {
  issuer: 'https://issuer.example.test',
  sub: 'user-1',
  expiresAt: Date.now() + 60_000,
  claims: { tableau_username: 'alice' },
};

function response(body: unknown, status = 200, headers: Record<string, string> = {}): TableauTransportResponse {
  return { status, headers, body: JSON.stringify(body) };
}

function signInResponse(token = 'token', siteId = 'site-luid'): TableauTransportResponse {
  return response({ credentials: { token, site: { id: siteId, contentUrl: 'sales' }, user: { id: 'user-luid' } } });
}

function collection(resource: 'workbooks' | 'views' | 'projects' | 'datasources', records: Record<string, unknown>[], total = records.length, pageNumber = 1, pageSize = 100) {
  const key = resource === 'datasources' ? 'datasource' : resource.slice(0, -1);
  return { pagination: { pageNumber: String(pageNumber), pageSize: String(pageSize), totalAvailable: String(total) }, [resource]: { [key]: records } };
}

function restWithPages(read: (resource: string, query?: { pageSize?: number; pageNumber?: number }) => unknown) {
  const client = { read: vi.fn(async (_user: TableauSignInUser, resource: string, query?: { pageSize?: number; pageNumber?: number }) => read(resource, query)) };
  return { client, rest: new TableauRest(client as never, config) };
}

describe('Tableau Phase 2 REST primitives', () => {
  it('validates search defaults and reads only authenticated site paths', async () => {
    expect(tableauSearchSchema.parse({})).toMatchObject({ query: '', type: 'all', limit: 20 });
    const requests: TableauTransportRequest[] = [];
    const transport: TableauTransport = async (request) => {
      requests.push(request);
      if (request.path.endsWith('/signin')) return signInResponse();
      return response(collection('workbooks', []));
    };
    const client = new TableauClient(config, { env: { OVP_TABLEAU_SECRET: 'secret' }, transport });
    await client.read(user, 'workbooks', { pageSize: 7, pageNumber: 2 });
    expect(requests.at(-1)).toMatchObject({ method: 'GET', path: '/api/3.23/sites/site-luid/workbooks?pageSize=7&pageNumber=2' });
    await expect(client.read(user, 'workbooks', { pageSize: 7, pageNumber: 2, raw: 'nope' } as never)).rejects.toMatchObject({ code: 'TABLEAU_QUERY_INVALID' });
  });

  it('retries 429 once, never retries 403, and retries 401 after evicting the user cache', async () => {
    const requests: TableauTransportRequest[] = [];
    let signIns = 0;
    let reads = 0;
    const transport: TableauTransport = async (request) => {
      requests.push(request);
      if (request.path.endsWith('/signin')) return signInResponse(`token-${++signIns}`);
      if (request.path.endsWith('/signout')) return response({}, 204);
      reads += 1;
      if (reads === 1) return response({}, 429, { 'retry-after': '0' });
      if (reads === 2) return response(collection('workbooks', []));
      return response({}, 403);
    };
    const client = new TableauClient(config, { env: { OVP_TABLEAU_SECRET: 'secret' }, transport });
    await client.read(user, 'workbooks');
    await expect(client.read(user, 'workbooks')).rejects.toMatchObject({ code: 'TABLEAU_HTTP_ERROR', status: 403 });
    expect(requests.filter((request) => request.method === 'GET')).toHaveLength(3);

    reads = 0;
    const authTransport: TableauTransport = async (request) => {
      if (request.path.endsWith('/signin')) return signInResponse(`auth-${++signIns}`);
      if (request.path.endsWith('/signout')) return response({}, 204);
      return reads++ === 0 ? response({}, 401) : response(collection('workbooks', []));
    };
    const authClient = new TableauClient(config, { env: { OVP_TABLEAU_SECRET: 'secret' }, transport: authTransport });
    await expect(authClient.read(user, 'workbooks')).resolves.toEqual(collection('workbooks', []));
    expect(signIns).toBeGreaterThan(1);
  });

  it('discards a protected response invalidated while its GET is in flight', async () => {
    let resolveRead!: (value: TableauTransportResponse) => void;
    const transport: TableauTransport = async (request) => {
      if (request.path.endsWith('/signin')) return signInResponse();
      if (request.path.endsWith('/signout')) return response({}, 204);
      return new Promise((resolve) => { resolveRead = resolve; });
    };
    const client = new TableauClient(config, { env: { OVP_TABLEAU_SECRET: 'secret' }, transport });
    const pending = client.read(user, 'workbooks');
    await vi.waitFor(() => expect(resolveRead).toBeTypeOf('function'));
    void client.clearUser(user.issuer, user.sub);
    resolveRead(response(collection('workbooks', [])));
    await expect(pending).rejects.toMatchObject({ code: 'TABLEAU_SIGNIN_INVALIDATED' });
  });

  it('paginates lists, handles empty collections, and reports a bounded list', async () => {
    const first = Array.from({ length: 100 }, (_, index) => ({ id: `w${index + 1}`, name: `Item ${index + 1}` }));
    const second = [{ id: 'w101', name: 'Item 101' }];
    const { rest } = restWithPages((_resource, query) => query?.pageNumber === 2
      ? collection('workbooks', second, 101, 2, 100)
      : collection('workbooks', first, 101, 1, 100));
    const listed = await rest.list(user, 'workbooks');
    expect(listed).toMatchObject({ scanned: 101, truncated: false });
    expect(listed.items[0]).toMatchObject({ id: 'w1' });
    expect(listed.items.at(-1)).toMatchObject({ id: 'w101' });

    const empty = restWithPages(() => collection('views', [], 0, 1, 100));
    await expect(empty.rest.list(user, 'views')).resolves.toEqual({ items: [], truncated: false, scanned: 0 });

    const bounded = restWithPages(() => collection('projects', [{ id: 'p1' }, { id: 'p2' }], 3, 1, 2));
    await expect(bounded.rest.list(user, 'projects', { limit: 2 })).resolves.toMatchObject({ scanned: 2, truncated: true, items: [{ name: 'p1' }, { name: 'p2' }] });
    await expect(bounded.rest.list(user, 'projects', { limit: 501 })).rejects.toMatchObject({ code: 'TABLEAU_QUERY_INVALID' });
  });

  it('rejects malformed pagination and empty pages that claim more records', async () => {
    const malformed = restWithPages(() => ({ workbooks: { workbook: [] } }));
    await expect(malformed.rest.list(user, 'workbooks')).rejects.toMatchObject({ code: 'TABLEAU_RESPONSE_INVALID' });
    const impossible = restWithPages(() => collection('workbooks', [], 2, 1, 100));
    await expect(impossible.rest.list(user, 'workbooks')).rejects.toMatchObject({ code: 'TABLEAU_RESPONSE_INVALID' });
  });

  it('searches only workbooks and views, joins authorized workbook parents, and filters locally', async () => {
    const workbook = { id: 'w1', name: 'Finance', contentUrl: 'Finance', project: { id: 'p1', name: 'Sales' }, owner: { id: 'o1', name: 'Alice' }, tags: { tag: [{ label: 'Quarterly' }] }, webpageUrl: 'https://evil.example.invalid/w' };
    const view = { id: 'v1', name: 'Revenue', contentUrl: 'Finance/sheets/Revenue', workbook: { id: 'w1', name: 'Untrusted Parent', project: { id: 'evil' }, owner: { id: 'evil' } }, tags: { tag: [{ label: 'Dashboard' }] } };
    const { rest, client } = restWithPages((resource, query) => resource === 'workbooks'
      ? collection('workbooks', [workbook], 1, 1, query?.pageSize)
      : resource === 'views' ? collection('views', [view], 1, 1, query?.pageSize) : collection(resource as 'projects', []));
    const result = await rest.search(user, { query: 'revenue', type: 'all', project: 'sales', owner: 'alice', tag: 'dash', limit: 20 });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ type: 'view', id: 'v1', project: { id: 'p1', name: 'Sales' }, owner: { id: 'o1', name: 'Alice' }, tags: ['Dashboard'], url: 'https://tableau.example.test/#/site/sales/views/Finance/Revenue' });
    expect(client.read.mock.calls.map((call) => call[1])).toEqual(['workbooks', 'views']);
    expect(result.limitations[0]).toContain('not a server-wide');
  });

  it('reports truncation for matches beyond the output limit and reserves half the scan for views', async () => {
    const many = Array.from({ length: 100 }, (_, index) => ({ id: `w${index}`, name: 'Match' }));
    const { rest } = restWithPages((resource, query) => {
      const size = query?.pageSize ?? 100;
      const page = query?.pageNumber ?? 1;
      return resource === 'workbooks'
        ? collection('workbooks', many.slice((page - 1) * size, page * size), 100, page, size)
        : collection('views', [{ id: 'v1', name: 'View' }], 1, page, size);
    });
    const result = await rest.search(user, { query: 'match', type: 'workbook', limit: 1 });
    expect(result.truncated).toBe(true);
    expect(result.items).toHaveLength(1);

    const viewResult = await rest.search(user, { type: 'view', limit: 20 });
    expect(viewResult.scanned).toBe(101);
    expect(viewResult.items[0]).toMatchObject({ type: 'view', id: 'v1' });
  });

  it('checks server and REST versions without swallowing probe failures', async () => {
    const { rest } = restWithPages((resource) => resource === 'serverinfo'
      ? { serverInfo: { productVersion: { value: '2025.3.0' }, restApiVersion: { value: '3.27' } } }
      : collection(resource as 'workbooks', [], 0, 1, 1));
    await expect(rest.check(user)).resolves.toMatchObject({ ok: true, serverVersion: '2025.3.0', apiVersion: '3.27', checks: [{ ok: true }, { ok: true }, { ok: true }, { ok: true }, { ok: true }] });

    const floor = restWithPages((resource) => resource === 'serverinfo'
      ? { serverInfo: { productVersion: { value: '2024.2.5' }, restApiVersion: { value: '3.23' } } }
      : collection(resource as 'workbooks', [], 0, 1, 1));
    await expect(floor.rest.check(user)).resolves.toMatchObject({ ok: true, serverVersion: '2024.2.5', apiVersion: '3.23' });

    const failed = restWithPages((resource) => resource === 'serverinfo'
      ? { serverInfo: { productVersion: { value: '2024.1.0' }, restApiVersion: { value: '3.22' } } }
      : resource === 'views' ? responseDoesNotExist() : collection(resource as 'workbooks', [], 0, 1, 1));
    const check = await failed.rest.check(user);
    expect(check.ok).toBe(false);
    expect(check.checks.find((item) => item.resource === 'serverinfo')).toMatchObject({ ok: false, code: 'TABLEAU_VERSION_UNSUPPORTED' });
    expect(check.checks.find((item) => item.resource === 'views')).toMatchObject({ ok: false, code: 'TABLEAU_RESPONSE_INVALID' });
  });

  it('classifies a server that does not serve the fixed REST version as unsupported', async () => {
    const versionNotFound = response({ error: { summary: 'Version Not Found', detail: 'unsupported', code: '404001' } }, 404);
    const transport: TableauTransport = async (request) => request.path.endsWith('/serverinfo') ? versionNotFound : response({}, 404);
    const client = new TableauClient(config, { env: { OVP_TABLEAU_SECRET: 'secret' }, transport });
    await expect(client.read(user, 'serverinfo')).rejects.toMatchObject({ code: 'TABLEAU_VERSION_UNSUPPORTED', status: 404 });
    await expect(client.signIn(user)).rejects.toMatchObject({ code: 'TABLEAU_AUTH_FAILED', status: 404 });
    const rest = new TableauRest(client, config);
    const check = await rest.check(user);
    expect(check.ok).toBe(false);
    expect(check.checks[0]).toMatchObject({ resource: 'serverinfo', ok: false, code: 'TABLEAU_VERSION_UNSUPPORTED' });
  });

  it('keeps only verified same-origin upstream links and supports ID lookup', async () => {
    const records = [{ id: 'w1', name: 'No Name Match', webpageUrl: 'https://tableau.example.test/#/workbooks/w1' }, { id: 'w2', webpageUrl: 'https://evil.example.invalid/w2' }];
    const { rest } = restWithPages((_resource, query) => collection('workbooks', records, 2, 1, query?.pageSize ?? 100));
    const result = await rest.search(user, { query: 'w2', type: 'workbook' });
    expect(result.items[0]).toMatchObject({ id: 'w2', name: 'w2' });
    expect(result.items[0]?.url).toBeUndefined();
    const listed = await rest.list(user, 'workbooks', { limit: 2 });
    expect(listed.items[0]?.url).toBe('https://tableau.example.test/#/workbooks/w1');
  });

  it('rethrows invalidation and abort failures instead of returning partial search results', async () => {
    const invalidated = restWithPages((resource) => {
      if (resource === 'workbooks') throw new TableauError('TABLEAU_SIGNIN_INVALIDATED');
      return collection('views', []);
    });
    await expect(invalidated.rest.search(user, {})).rejects.toMatchObject({ code: 'TABLEAU_SIGNIN_INVALIDATED' });

    const expired = restWithPages(() => { throw new TableauError('TABLEAU_IDENTITY_EXPIRED'); });
    await expect(expired.rest.search(user, {})).rejects.toMatchObject({ code: 'TABLEAU_IDENTITY_EXPIRED' });

    const aborted = new AbortController();
    aborted.abort();
    const empty = restWithPages(() => collection('workbooks', []));
    await expect(empty.rest.search(user, {}, aborted.signal)).rejects.toMatchObject({ code: 'TABLEAU_ABORTED' });
  });

  it('enforces the ten-second operation deadline for a hung reader', async () => {
    vi.useFakeTimers();
    try {
      const hung = restWithPages(() => new Promise<never>(() => {}));
      const pending = hung.rest.list(user, 'workbooks');
      const expectation = expect(pending).rejects.toMatchObject({ code: 'TABLEAU_TIMEOUT' });
      await vi.advanceTimersByTimeAsync(10_000);
      await expectation;
    } finally {
      vi.useRealTimers();
    }
  });
});

function responseDoesNotExist(): never {
  throw new TableauError('TABLEAU_RESPONSE_INVALID');
}
