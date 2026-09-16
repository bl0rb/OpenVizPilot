import { afterEach, describe, expect, it, vi } from 'vitest';
import { TableauMetadata } from '../server/src/tableau-server/metadata';
import type { TableauConfig } from '../server/src/tableau-server/config';
import type { TableauSignInUser } from '../server/src/tableau-server/client';

const config = {
  enabled: true, serverUrl: 'https://tableau.example.test', siteContentUrl: 'sales', clientId: 'client',
  secretId: 'key', secretEnv: 'OVP_TABLEAU_TEST', usernameClaim: 'upn', siteId: '', revision: '11111111-1111-4111-8111-111111111111',
  apiVersion: '3.23', authMode: 'connected-app',
} satisfies TableauConfig;
const user: TableauSignInUser = { issuer: 'https://idp.example.test', sub: 'alice', expiresAt: Date.now() + 3600_000, claims: { upn: 'alice' } };
const connection = (nodes: unknown[], hasNextPage = false, endCursor: string | null = null) => ({ nodes, pageInfo: { hasNextPage, endCursor } });
const field = (overrides: Record<string, unknown> = {}) => ({
  __typename: 'CalculatedField', id: 'field-1', name: 'Profit Ratio', formula: 'SUM([Profit])/SUM([Sales])',
  datasource: { id: 'ds-1', name: 'Sales' }, upstreamFieldsConnection: connection([]), upstreamColumnsConnection: connection([]),
  downstreamSheetsConnection: connection([]), downstreamWorkbooksConnection: connection([]), ...overrides,
});
const metadataFor = (value: unknown) => new TableauMetadata({ queryMetadata: vi.fn(async () => value) }, config);
afterEach(() => vi.useRealTimers());

describe('Tableau Metadata API boundary regression tests', () => {
  it('rejects a field response whose ID differs from the requested opaque ID', async () => {
    const metadata = metadataFor({ data: { fieldsConnection: connection([field({ id: 'other-field' })]) } });
    await expect(metadata.field(user, { fieldId: 'field-1' })).rejects.toBeDefined();
  });

  it('omits redacted nodes completely, including their IDs and formulas', async () => {
    const redacted = field({ name: null, id: 'private-field', formula: 'private-formula' });
    const search = await metadataFor({ data: { fieldsConnection: connection([redacted]) } }).search(user, {});
    expect(search.items).toHaveLength(0);
    expect(JSON.stringify(search)).not.toContain('private-');
    const detail = await metadataFor({ data: { fieldsConnection: connection([redacted]) } }).field(user, { fieldId: 'private-field' });
    expect(detail.field).toBeNull();
    expect(JSON.stringify(detail)).not.toContain('private-');
  });

  it('preserves downstream workbook summaries actually selected by the fixed query', async () => {
    const metadata = metadataFor({ data: { fieldsConnection: connection([field({
      downstreamWorkbooksConnection: connection([{ id: 'wb-1', name: 'Sales Dashboard' }]),
    })]) } });
    const result = await metadata.field(user, { fieldId: 'field-1' });
    expect(result.field?.downstream.workbooks).toContainEqual(expect.objectContaining({ id: 'wb-1', name: 'Sales Dashboard' }));
  });

  it('never returns a clipped calculation as a complete formula', async () => {
    const formula = '[Profit] + '.repeat(2500) + '[Sales]';
    const metadata = metadataFor({ data: { fieldsConnection: connection([field({ formula })]) } });
    const result = await metadata.field(user, { fieldId: 'field-1' });
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(20_000);
    expect(result.field?.formula).toBeUndefined();
    expect(result.truncated).toBe(true);
    expect(result.limitations.length).toBeGreaterThan(0);
  });

  it('bounds actual retrieval to 500 even when upstream pages are shorter than requested', async () => {
    let fetched = 0;
    const metadata = new TableauMetadata({ queryMetadata: vi.fn(async (_user, _document, variables) => {
      const count = Math.min(Number(variables.first), 80);
      const nodes = Array.from({ length: count }, (_, index) => ({ __typename: 'ColumnField', id: `f-${fetched + index}`, name: `Field ${fetched + index}` }));
      fetched += count;
      return { data: { fieldsConnection: connection(nodes, true, `cursor-${fetched}`) } };
    }) }, config);
    const result = await metadata.search(user, { limit: 1 });
    expect(fetched).toBeLessThanOrEqual(500);
    expect(result.truncated).toBe(true);
    expect(result.items).toHaveLength(1);
  });

  it('does not describe fully traversed search pages as partial', async () => {
    const queryMetadata = vi.fn()
      .mockResolvedValueOnce({ data: { fieldsConnection: connection([field()], true, 'next') } })
      .mockResolvedValueOnce({ data: { fieldsConnection: connection([field({ id: 'field-2' })]) } });
    const result = await new TableauMetadata({ queryMetadata }, config).search(user, {});
    expect(result.items).toHaveLength(2);
    expect(result.truncated).toBe(false);
    expect(result.limitations.join(' ')).not.toContain('is partial');
  });

  it('does not keep a metadata query running past the overall deadline', async () => {
    vi.useFakeTimers();
    const metadata = new TableauMetadata({ queryMetadata: vi.fn(() => new Promise(() => {})) }, config);
    const pending = expect(metadata.search(user, {})).rejects.toMatchObject({ code: 'TABLEAU_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(10_000);
    await pending;
    expect(vi.getTimerCount()).toBe(0);
  });
});
