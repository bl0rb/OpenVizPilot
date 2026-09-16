import { afterEach, describe, expect, it, vi } from 'vitest';
import { TableauRest } from '../server/src/tableau-server/rest';
import { TableauError } from '../server/src/tableau-server/errors';
import type { TableauConfig } from '../server/src/tableau-server/config';
import type { TableauReadResource, TableauSignInUser } from '../server/src/tableau-server/client';

const config = {
  enabled: true, serverUrl: 'https://tableau.example.test', siteContentUrl: 'sales',
  clientId: 'client', secretId: 'secret', secretEnv: 'OVP_TABLEAU_TEST', usernameClaim: 'upn', siteId: '',
  revision: '11111111-1111-4111-8111-111111111111', apiVersion: '3.23', authMode: 'connected-app',
} satisfies TableauConfig;
const user: TableauSignInUser = { issuer: 'https://idp.example.test', sub: 'user', expiresAt: Date.now() + 3600_000, claims: { upn: 'alice' } };

afterEach(() => vi.useRealTimers());

describe('Tableau operation budgets', () => {
  it('derives view links only from supported content paths and keeps the configured site', async () => {
    const read = vi.fn(async () => ({
      pagination: { pageSize: 100, pageNumber: 1, totalAvailable: 3 },
      views: { view: [
        { id: 'v1', contentUrl: 'Revenue/sheets/Quarter' },
        { id: 'v2', contentUrl: '../sheets/Private' },
        { id: 'v3', contentUrl: 'unsupported' },
      ] },
    }));
    const result = await new TableauRest({ read }, config).list(user, 'views');
    expect(result.items[0]?.url).toBe('https://tableau.example.test/#/site/sales/views/Revenue/Quarter');
    expect(result.items[1]?.url).toBeUndefined();
    expect(result.items[2]?.url).toBeUndefined();
    const defaultSite = await new TableauRest({ read }, { ...config, siteContentUrl: '' }).list(user, 'views');
    expect(defaultSite.items[0]?.url).toBe('https://tableau.example.test/#/views/Revenue/Quarter');
  });

  it('bounds fetched records as well as normalized records and reserves capacity for views', async () => {
    let fetched = 0;
    const resources: string[] = [];
    const read = vi.fn(async (_user: TableauSignInUser, resource: TableauReadResource, query?: { pageSize?: number; pageNumber?: number }) => {
      resources.push(resource);
      const pageSize = query!.pageSize!;
      const pageNumber = query!.pageNumber!;
      fetched += pageSize;
      const key = resource === 'workbooks' ? 'workbook' : 'view';
      return {
        pagination: { pageSize, pageNumber, totalAvailable: 1000 },
        [resource]: { [key]: Array.from({ length: pageSize }, (_, index) => ({
          id: `${resource}-${pageNumber}-${index}`, name: resource === 'views' ? 'Target' : 'Other',
        })) },
      };
    });
    const result = await new TableauRest({ read }, config).search(user, { type: 'view', query: 'Target' });
    expect(result.scanned).toBe(500);
    expect(fetched).toBeLessThanOrEqual(500);
    expect(resources).toContain('views');
    expect(result.items).toHaveLength(20);
    expect(result.items.every(item => item.type === 'view')).toBe(true);
    expect(result.truncated).toBe(true);
  });

  it('rejects already cancelled work without a network call', async () => {
    const read = vi.fn();
    const controller = new AbortController();
    controller.abort();
    await expect(new TableauRest({ read }, config).search(user, {}, controller.signal)).rejects.toMatchObject({ code: 'TABLEAU_ABORTED' });
    expect(read).not.toHaveBeenCalled();
  });

  it('enforces one deadline even if a dependency fails to settle and clears the timer on success', async () => {
    vi.useFakeTimers();
    const rest = new TableauRest({ read: vi.fn(() => new Promise(() => {})) }, config);
    const pending = expect(rest.search(user, {})).rejects.toMatchObject({ code: 'TABLEAU_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(10_000);
    await pending;
    expect(vi.getTimerCount()).toBe(0);
    const fast = new TableauRest({ read: vi.fn(async () => ({ pagination: { pageNumber: 1, pageSize: 100, totalAvailable: 0 }, workbooks: {} })) }, config);
    await fast.search(user, { type: 'workbook' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('never returns partial results when a user session was invalidated', async () => {
    const read = vi.fn(async (_user: TableauSignInUser, resource: TableauReadResource, query?: { pageSize?: number }) => {
      if (resource === 'views') throw new TableauError('TABLEAU_SIGNIN_INVALIDATED');
      return { pagination: { pageNumber: 1, pageSize: query!.pageSize, totalAvailable: 1 }, workbooks: { workbook: [{ id: 'w1', name: 'Sensitive' }] } };
    });
    await expect(new TableauRest({ read }, config).search(user, {})).rejects.toMatchObject({ code: 'TABLEAU_SIGNIN_INVALIDATED' });
  });
});
