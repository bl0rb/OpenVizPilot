import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openSqliteDatabase } from '../../packages/server/src/memory/sqlite-store';
import type { AuthVariables } from '../server/src/auth-routes';
import { encryptSecret } from '../server/src/secrets';
import { TableauClient } from '../server/src/tableau-server/client';
import {
  encryptTableauSiteSecret,
  resolveTableauSite,
  tableauConfigSchema,
  tableauServerConfigSchema,
  type TableauSite,
} from '../server/src/tableau-server/config';
import { createTableauAdminRoute, createTableauRoute } from '../server/src/tableau-server/routes';
import { TableauService, type TableauAccess } from '../server/src/tableau-server/service';
import { createSqliteTableauStore } from '../server/src/tableau-server/store';

const REVISION = '11111111-1111-4111-8111-111111111111';
const KEY_ENV = { OVP_SECRET_KEY: 'a-secret-key-that-is-at-least-32-chars-long' };

describe('Tableau config migration (legacy single-site blob predating Teil B)', () => {
  it('upgrades an old flat blob into sites: [{ id: "default", ... }]', () => {
    const legacy = {
      enabled: true, serverUrl: 'https://tableau.example.com', siteContentUrl: 'sales',
      clientId: 'client-1', secretId: 'secret-1', secretEnv: 'OVP_TABLEAU_LEGACY',
      usernameClaim: 'upn', siteId: '', revision: REVISION, apiVersion: '3.23', authMode: 'connected-app',
    };
    const parsed = tableauServerConfigSchema.parse(legacy);
    expect(parsed.sites).toEqual([{
      id: 'default', name: 'sales', contentUrl: 'sales', authMode: 'connected-app',
      clientId: 'client-1', secretId: 'secret-1', secretEnv: 'OVP_TABLEAU_LEGACY', siteId: '',
    }]);
    expect(parsed.dashboardSites).toEqual({});
    expect(parsed.serverUrl).toBe('https://tableau.example.com');
    expect(parsed.usernameClaim).toBe('upn');
  });

  it('falls back to "Standard-Site" as the migrated site name when siteContentUrl is empty', () => {
    const legacy = {
      enabled: false, serverUrl: '', siteContentUrl: '', clientId: '', secretId: '', secretEnv: '',
      usernameClaim: '', siteId: '', revision: REVISION, apiVersion: '3.23', authMode: 'connected-app',
    };
    expect(tableauServerConfigSchema.parse(legacy).sites[0]!.name).toBe('Standard-Site');
  });

  it('leaves an already-migrated config (carrying a sites array) untouched', () => {
    const modern = {
      enabled: false, serverUrl: '', usernameClaim: '', apiVersion: '3.23', revision: REVISION,
      sites: [], dashboardSites: {},
    };
    expect(tableauServerConfigSchema.parse(modern)).toEqual(modern);
  });
});

describe('Tableau config: multi-site validation', () => {
  const site = (overrides: Partial<TableauSite>): TableauSite => ({
    id: 'a', name: 'A', contentUrl: '', authMode: 'connected-app', clientId: 'c', secretId: 's', secretEnv: 'OVP_TABLEAU_A', siteId: '', ...overrides,
  });

  it('rejects duplicate site ids and duplicate content URLs', () => {
    expect(() => tableauServerConfigSchema.parse({
      enabled: false, serverUrl: '', usernameClaim: '', apiVersion: '3.23', revision: REVISION,
      sites: [site({ id: 'a', contentUrl: 'x' }), site({ id: 'a', contentUrl: 'y' })], dashboardSites: {},
    })).toThrow();
    expect(() => tableauServerConfigSchema.parse({
      enabled: false, serverUrl: '', usernameClaim: '', apiVersion: '3.23', revision: REVISION,
      sites: [site({ id: 'a', contentUrl: 'x' }), site({ id: 'b', contentUrl: 'x' })], dashboardSites: {},
    })).toThrow();
  });

  it('rejects dashboardSites entries that reference a site that does not exist', () => {
    expect(() => tableauServerConfigSchema.parse({
      enabled: false, serverUrl: '', usernameClaim: '', apiVersion: '3.23', revision: REVISION,
      sites: [site({ id: 'a' })], dashboardSites: { 'dash-1': 'missing-site' },
    })).toThrow();
  });

  it('requires siteId (LUID) for oauth2-trust and clientId/secretId for connected-app, per site, only while enabled', () => {
    const oauth2NoLuid = {
      enabled: true as const, serverUrl: 'https://tableau.example.com', usernameClaim: 'upn', apiVersion: '3.23' as const, revision: REVISION,
      sites: [site({ authMode: 'oauth2-trust', siteId: '' })], dashboardSites: {},
    };
    expect(() => tableauServerConfigSchema.parse(oauth2NoLuid)).toThrow();
    // The same, still-incomplete site is fine as long as the whole integration stays a disabled draft.
    expect(() => tableauServerConfigSchema.parse({ ...oauth2NoLuid, enabled: false })).not.toThrow();
  });

  it('caps sites at 50', () => {
    const sites = Array.from({ length: 51 }, (_, index) => site({ id: 'a' + index, contentUrl: 'c' + index }));
    expect(() => tableauServerConfigSchema.parse({
      enabled: false, serverUrl: '', usernameClaim: '', apiVersion: '3.23', revision: REVISION, sites, dashboardSites: {},
    })).toThrow();
  });
});

describe('resolveTableauSite: explicit siteId, dashboardKey mapping, sole-site fallback', () => {
  const config = tableauServerConfigSchema.parse({
    enabled: true, serverUrl: 'https://tableau.example.com', usernameClaim: 'upn', apiVersion: '3.23', revision: REVISION,
    sites: [
      { id: 'sales', name: 'Sales', contentUrl: 'sales', authMode: 'connected-app', clientId: 'c1', secretId: 's1', secretEnv: 'OVP_TABLEAU_SALES', siteId: '' },
      { id: 'mktg', name: 'Marketing', contentUrl: 'mktg', authMode: 'connected-app', clientId: 'c2', secretId: 's2', secretEnv: 'OVP_TABLEAU_MKTG', siteId: '' },
    ],
    dashboardSites: { 'dashboard-1': 'mktg' },
  });

  it('prefers an explicit siteId', () => {
    expect(resolveTableauSite(config, { siteId: 'sales' }).id).toBe('sales');
  });

  it('resolves via the dashboardKey mapping when no siteId is given', () => {
    expect(resolveTableauSite(config, { dashboardKey: 'dashboard-1' }).id).toBe('mktg');
  });

  it('throws TABLEAU_SITE_UNRESOLVED when ambiguous, or when siteId/dashboardKey do not match a configured site', () => {
    expect(() => resolveTableauSite(config, {})).toThrow();
    expect(() => resolveTableauSite(config, { dashboardKey: 'unmapped-dashboard' })).toThrow();
    expect(() => resolveTableauSite(config, { siteId: 'unknown' })).toThrow();
  });

  it('falls back to the sole configured site when exactly one exists', () => {
    const single = tableauServerConfigSchema.parse({ ...config, sites: [config.sites[0]!], dashboardSites: {} });
    expect(resolveTableauSite(single, {}).id).toBe('sales');
  });
});

describe('encryptTableauSiteSecret: merges a PUT site with the previously stored secret', () => {
  const baseInput = { id: 'a', name: 'A', contentUrl: '', authMode: 'connected-app' as const, clientId: 'c', secretId: 's', secretEnv: '', siteId: '' };

  it('encrypts a freshly provided plaintext secret', () => {
    const site = encryptTableauSiteSecret({ ...baseInput, secret: 'plain-text-secret' }, undefined, KEY_ENV);
    expect(site.secret).toBeDefined();
    expect(JSON.stringify(site)).not.toContain('plain-text-secret');
  });

  it('keeps the previously stored secret when no secret field is sent', () => {
    const previous: TableauSite = { ...baseInput, secret: encryptSecret('kept-secret', KEY_ENV) };
    const site = encryptTableauSiteSecret({ ...baseInput }, previous, KEY_ENV);
    expect(site.secret).toEqual(previous.secret);
  });

  it('clears the stored secret when secretClear is set, even if a previous secret existed', () => {
    const previous: TableauSite = { ...baseInput, secret: encryptSecret('old-secret', KEY_ENV) };
    const site = encryptTableauSiteSecret({ ...baseInput, secretClear: true }, previous, KEY_ENV);
    expect(site.secret).toBeUndefined();
  });

  it('does not carry a previous secret over to a different site id', () => {
    const previous: TableauSite = { ...baseInput, id: 'other', secret: encryptSecret('old-secret', KEY_ENV) };
    const site = encryptTableauSiteSecret({ ...baseInput, id: 'a' }, previous, KEY_ENV);
    expect(site.secret).toBeUndefined();
  });
});

describe('Tableau flat runtime config (TableauClient): a DB-only secret is a valid alternative to secretEnv', () => {
  it('does not require secretEnv when a DB secret is present (the shape TableauService.toClientConfig builds for a resolved site)', () => {
    const withDbSecretOnly = {
      enabled: true, serverUrl: 'https://tableau.example.com', siteContentUrl: '', clientId: 'c', secretId: 's',
      secretEnv: '', secret: encryptSecret('db-only-secret', KEY_ENV), usernameClaim: 'upn', siteId: '',
      revision: REVISION, apiVersion: '3.23' as const, authMode: 'connected-app' as const,
    };
    expect(() => tableauConfigSchema.parse(withDbSecretOnly)).not.toThrow();
  });

  it('still rejects an enabled connected-app config with neither a DB secret nor a valid secretEnv', () => {
    const neither = {
      enabled: true, serverUrl: 'https://tableau.example.com', siteContentUrl: '', clientId: 'c', secretId: 's',
      secretEnv: '', usernameClaim: 'upn', siteId: '', revision: REVISION, apiVersion: '3.23' as const, authMode: 'connected-app' as const,
    };
    expect(() => tableauConfigSchema.parse(neither)).toThrow();
  });

  it('end-to-end: a real TableauClient signs in using a site secret stored only in the DB (no secretEnv)', async () => {
    const cleanups: Array<() => void> = [];
    try {
      vi.stubEnv('OVP_SECRET_KEY', KEY_ENV.OVP_SECRET_KEY);
      const db = openSqliteDatabase(':memory:');
      const store = createSqliteTableauStore(db);
      const user = { issuer: 'https://idp.example.test', sub: 'alice', expiresAt: Date.now() + 3600_000, claims: { upn: 'alice' } };
      const access: TableauAccess = { licensed: true, oidcReady: true, issuer: user.issuer, identityRevision: 'v1', publicUrl: 'https://ovp.example.com' };
      const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
      let signedInWith: string | undefined;
      const service = new TableauService(store, async () => access, logger, async () => 'salt', (config, eas) => new TableauClient(config, {
        eas: eas ?? undefined,
        transport: async (request) => {
          signedInWith = JSON.parse(request.body ?? '{}').credentials?.jwt;
          return { status: 200, headers: {}, body: JSON.stringify({ credentials: { token: 'session', site: { id: 'x', contentUrl: '' }, user: { id: 'u', name: 'alice' } } }) };
        },
      }));
      cleanups.push(() => { service.stop(); db.close(); });
      await store.set({
        enabled: true, serverUrl: 'https://tableau.example.com', usernameClaim: 'upn', apiVersion: '3.23',
        sites: [{ id: 'a', name: 'A', contentUrl: '', authMode: 'connected-app', clientId: 'client', secretId: 'secret-id', secretEnv: '', siteId: '', secret: encryptSecret('db-only-secret', KEY_ENV) }],
        dashboardSites: {},
      }, null);
      await expect(service.check(user)).resolves.toEqual({ ok: true, stage: 'authentication' });
      expect(signedInWith).toBeDefined();
    } finally {
      cleanups.forEach((fn) => fn());
      vi.unstubAllEnvs();
    }
  });
});

describe('Tableau admin routes: secrets and multi-site behavior', () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => { cleanups.splice(0).forEach((fn) => fn()); vi.unstubAllEnvs(); });

  function fixture() {
    vi.stubEnv('OVP_SECRET_KEY', KEY_ENV.OVP_SECRET_KEY);
    const db = openSqliteDatabase(':memory:');
    const store = createSqliteTableauStore(db);
    const access: TableauAccess = { licensed: true, oidcReady: true, issuer: 'https://idp.example.test', identityRevision: 'v1', publicUrl: 'https://ovp.example.com' };
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const service = new TableauService(store, async () => access, logger, async () => 'salt');
    cleanups.push(() => { service.stop(); db.close(); });
    const admin = createTableauAdminRoute(service, logger);
    const request = (method: string, body?: unknown, path = '/') => admin.request(path, {
      method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { store, service, request };
  }

  it('PUT encrypts a plaintext secret; GET never returns it, only secretConfigured: "db"', async () => {
    const f = fixture();
    const config = {
      enabled: true, serverUrl: 'https://tableau.example.com', usernameClaim: 'upn', apiVersion: '3.23' as const,
      sites: [{ id: 'a', name: 'A', contentUrl: '', authMode: 'connected-app' as const, clientId: 'c', secretId: 's', secretEnv: '', siteId: '', secret: 'plaintext-secret-value' }],
      dashboardSites: {},
    };
    const putResponse = await f.request('PUT', { config, expectedRevision: null });
    expect(putResponse.status).toBe(200);
    const putText = await putResponse.text();
    expect(putText).not.toContain('plaintext-secret-value');
    expect(putText).toContain('"secretConfigured":"db"');

    const getResponse = await f.request('GET');
    const getText = await getResponse.text();
    expect(getText).not.toContain('plaintext-secret-value');
    expect(getText).not.toContain('"iv"');
    expect(getText).not.toContain('"tag"');
    expect(getText).toContain('"secretConfigured":"db"');
  });

  it('PUT without a secret field keeps the previously stored one; secretClear removes it', async () => {
    const f = fixture();
    const baseSite = { id: 'a', name: 'A', contentUrl: '', authMode: 'connected-app' as const, clientId: 'c', secretId: 's', secretEnv: '', siteId: '' };
    await f.request('PUT', {
      config: { enabled: true, serverUrl: 'https://tableau.example.com', usernameClaim: 'upn', apiVersion: '3.23', sites: [{ ...baseSite, secret: 'first-secret' }], dashboardSites: {} },
      expectedRevision: null,
    });
    const afterFirst = await (await f.request('GET')).json() as { revision: string };

    const keepResponse = await f.request('PUT', {
      config: { enabled: true, serverUrl: 'https://tableau.example.com', usernameClaim: 'upn', apiVersion: '3.23', sites: [baseSite], dashboardSites: {} },
      expectedRevision: afterFirst.revision,
    });
    expect(keepResponse.status).toBe(200);
    expect(await keepResponse.text()).toContain('"secretConfigured":"db"');

    // Clearing the DB secret while keeping the site enabled needs a fallback (secretEnv) — otherwise
    // the "secret or secretEnv required" rule (tested separately below) would reject the save. A
    // disabled draft has no such requirement and isolates exactly what secretClear does.
    const afterKeep = await (await f.request('GET')).json() as { revision: string };
    const clearResponse = await f.request('PUT', {
      config: { enabled: false, serverUrl: '', usernameClaim: '', apiVersion: '3.23', sites: [{ ...baseSite, secretClear: true }], dashboardSites: {} },
      expectedRevision: afterKeep.revision,
    });
    expect(clearResponse.status).toBe(200);
    expect(await clearResponse.text()).toContain('"secretConfigured":false');
  });

  it('names the offending site when neither a DB secret nor a secretEnv is set for an enabled connected-app site', async () => {
    const f = fixture();
    const response = await f.request('PUT', {
      config: {
        enabled: true, serverUrl: 'https://tableau.example.com', usernameClaim: 'upn', apiVersion: '3.23',
        sites: [{ id: 'a', name: 'Sales', contentUrl: '', authMode: 'connected-app', clientId: 'c', secretId: 's', secretEnv: '', siteId: '' }],
        dashboardSites: {},
      },
      expectedRevision: null,
    });
    expect(response.status).toBe(400);
    const body = await response.json() as { code: string; siteId: string };
    expect(body.code).toBe('secret_missing');
    expect(body.siteId).toBe('a');
  });

  it('rejects saving a plaintext secret without OVP_SECRET_KEY configured', async () => {
    const f = fixture();
    vi.stubEnv('OVP_SECRET_KEY', '');
    const response = await f.request('PUT', {
      config: {
        enabled: false, serverUrl: '', usernameClaim: '', apiVersion: '3.23',
        sites: [{ id: 'a', name: 'A', contentUrl: '', authMode: 'connected-app', clientId: '', secretId: '', secretEnv: '', siteId: '', secret: 'plaintext' }],
        dashboardSites: {},
      },
      expectedRevision: null,
    });
    expect(response.status).toBe(400);
    expect((await response.json() as { code: string }).code).toBe('secret_key_missing');
  });

  it('resolves /check by explicit siteId across multiple sites, and rejects an ambiguous request', async () => {
    const f = fixture();
    vi.stubEnv('OVP_TABLEAU_SALES', 'sales-secret');
    vi.stubEnv('OVP_TABLEAU_MKTG', 'mktg-secret');
    await f.request('PUT', {
      config: {
        enabled: true, serverUrl: 'https://tableau.example.com', usernameClaim: 'upn', apiVersion: '3.23',
        sites: [
          { id: 'sales', name: 'Sales', contentUrl: 'sales', authMode: 'connected-app', clientId: 'c1', secretId: 's1', secretEnv: 'OVP_TABLEAU_SALES', siteId: '' },
          { id: 'mktg', name: 'Marketing', contentUrl: 'mktg', authMode: 'connected-app', clientId: 'c2', secretId: 's2', secretEnv: 'OVP_TABLEAU_MKTG', siteId: '' },
        ],
        dashboardSites: {},
      },
      expectedRevision: null,
    });

    const ambiguous = await f.request('POST', undefined, '/check');
    expect(ambiguous.status).toBe(400);
    expect((await ambiguous.json() as { code: string }).code).toBe('site_unresolved');

    const resolved = await f.request('POST', { siteId: 'mktg' }, '/check');
    expect(resolved.status).toBe(200);

    // Presence only: verschwindet die referenzierte Env-Variable, meldet GET secretConfigured: false und /check schlägt fehl.
    vi.stubEnv('OVP_TABLEAU_MKTG', '');
    const view = await (await f.request('GET')).json() as { config: { sites: Array<{ id: string; secretConfigured: unknown }> } };
    expect(view.config.sites.find((site) => site.id === 'mktg')?.secretConfigured).toBe(false);
    expect((await f.request('POST', { siteId: 'mktg' }, '/check')).status).toBe(400);
  });
});

describe('Tableau extension routes: dashboardKey resolves a site; unresolved surfaces a specific message', () => {
  const user = { issuer: 'https://idp.example.test', sub: 'alice', expiresAt: Date.now() + 3600_000, claims: { upn: 'Alice' } };
  const cleanups: Array<() => void> = [];
  afterEach(() => { cleanups.splice(0).forEach((fn) => fn()); vi.unstubAllEnvs(); });

  async function fixture() {
    vi.stubEnv('OVP_TABLEAU_SALES', 'sales-secret');
    vi.stubEnv('OVP_TABLEAU_MKTG', 'mktg-secret');
    const db = openSqliteDatabase(':memory:');
    const store = createSqliteTableauStore(db);
    const access: TableauAccess = { licensed: true, oidcReady: true, issuer: user.issuer, identityRevision: 'v1', publicUrl: 'https://ovp.example.com' };
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const empty = { workbooks: { workbook: [] }, pagination: { pageNumber: 1, pageSize: 100, totalAvailable: 0 } };
    const client = {
      signIn: vi.fn(async () => ({ token: 't', siteId: 's', userId: 'u' })), clear: vi.fn(async () => {}),
      clearUser: vi.fn(async () => {}), prune: vi.fn(async () => {}), read: vi.fn(async () => empty), queryMetadata: vi.fn(async () => ({})),
    };
    const service = new TableauService(store, async () => access, logger, async () => 'salt', () => client);
    cleanups.push(() => { service.stop(); db.close(); });
    await store.set({
      enabled: true, serverUrl: 'https://tableau.example.com', usernameClaim: 'upn', apiVersion: '3.23',
      sites: [
        { id: 'sales', name: 'Sales', contentUrl: 'sales', authMode: 'connected-app', clientId: 'c1', secretId: 's1', secretEnv: 'OVP_TABLEAU_SALES', siteId: '' },
        { id: 'mktg', name: 'Marketing', contentUrl: 'mktg', authMode: 'connected-app', clientId: 'c2', secretId: 's2', secretEnv: 'OVP_TABLEAU_MKTG', siteId: '' },
      ],
      dashboardSites: { 'dashboard-mktg': 'mktg' },
    }, null);
    const app = new Hono<AuthVariables>();
    app.use('*', async (c, next) => { c.set('oidcUser', user); await next(); });
    app.route('/', createTableauRoute(service));
    return { app, client };
  }

  it('resolves the site via dashboardKey and searches successfully', async () => {
    const f = await fixture();
    const response = await f.app.request('/search', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dashboardKey: 'dashboard-mktg' }) });
    expect(response.status).toBe(200);
  });

  it('surfaces a specific, actionable message when the dashboard has no site mapping and multiple sites exist', async () => {
    const f = await fixture();
    const response = await f.app.request('/search', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dashboardKey: 'unmapped-dashboard' }) });
    expect(response.status).toBe(400);
    const body = await response.json() as { code: string; error: string };
    expect(body.code).toBe('site_unresolved');
    expect(body.error).toBe('Dashboard ist keiner Tableau-Site zugeordnet — im Admin unter Tableau Server zuordnen.');
  });
});
