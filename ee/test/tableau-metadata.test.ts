import { describe, expect, it, vi } from 'vitest';
import { TableauError } from '../server/src/tableau-server/errors';
import type { TableauConfig } from '../server/src/tableau-server/config';
import { METADATA_FIELD_QUERY, METADATA_SEARCH_QUERY } from '../server/src/tableau-server/metadata-queries';
import { TableauMetadata } from '../server/src/tableau-server/metadata';

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

const user = {
  issuer: 'https://issuer.example.test',
  sub: 'user-1',
  expiresAt: Date.now() + 60_000,
  claims: { tableau_username: 'alice' },
};

function connection(nodes: unknown[], hasNextPage = false, endCursor: string | null = null) {
  return { nodes, pageInfo: { hasNextPage, endCursor } };
}

function searchResponse(nodes: unknown[], hasNextPage = false, endCursor: string | null = null) {
  return { data: { fieldsConnection: connection(nodes, hasNextPage, endCursor) } };
}

function fieldResponse(node: unknown, options: { hasNextPage?: boolean } = {}) {
  return {
    data: {
      fieldsConnection: connection([node], options.hasNextPage ?? false, options.hasNextPage ? 'root-next' : null),
    },
  };
}

function metadataWith(responses: unknown[] | ((document: string, variables: Record<string, unknown>) => unknown | Promise<unknown>)) {
  const queryMetadata = vi.fn(async (_user: typeof user, document: string, variables: Record<string, unknown>) => {
    if (typeof responses === 'function') return responses(document, variables);
    const response = responses.shift();
    return response;
  });
  return { queryMetadata, metadata: new TableauMetadata({ queryMetadata }, config) };
}

describe('Tableau Metadata API primitives', () => {
  it('uses fixed variable-driven search pagination and performs datasource filtering locally', async () => {
    const first = {
      __typename: 'CalculatedField', id: 'field-1', name: 'Sales Total', description: 'sum', dataType: 'REAL',
      datasource: { id: 'datasource-1', name: 'Sales' }, formula: 'SECRET_FORMULA_MUST_NOT_ESCAPE_SEARCH',
    };
    const duplicate = { __typename: 'CalculatedField', id: 'field-1', name: 'Different duplicate', datasource: { id: 'datasource-1' } };
    const second = { __typename: 'ColumnField', id: 'field-2', name: 'Sales Region', datasource: { id: 'datasource-2' } };
    const third = { __typename: 'ColumnField', id: 'field-3', name: 'Sales Amount', datasource: { id: 'datasource-1' } };
    const { metadata, queryMetadata } = metadataWith([searchResponse([first, duplicate, second], true, 'cursor-1'), searchResponse([third])]);

    const result = await metadata.search(user, { query: 'Sales', datasourceId: 'datasource-1', limit: 1 });

    expect(result.items).toEqual([{ id: 'field-1', type: 'CalculatedField', name: 'Sales Total', description: 'sum', dataType: 'REAL', datasource: { id: 'datasource-1', name: 'Sales' } }]);
    expect(result).toMatchObject({ scanned: 4, truncated: true, source: 'Tableau Metadata API' });
    expect(queryMetadata).toHaveBeenCalledTimes(2);
    expect(queryMetadata.mock.calls[0]?.[1]).toBe(METADATA_SEARCH_QUERY);
    expect(queryMetadata.mock.calls[0]?.[2]).toEqual({ filter: { text: 'Sales' }, first: 100, after: null });
    expect(queryMetadata.mock.calls[1]?.[2]).toEqual({ filter: { text: 'Sales' }, first: 100, after: 'cursor-1' });
    expect(METADATA_SEARCH_QUERY).not.toContain('formula');
    expect(result.limitations.some((item) => item.includes('duplicate'))).toBe(true);
  });

  it('returns calculated-field detail and bounded lineage without raw connection data', async () => {
    const root = {
      __typename: 'CalculatedField', id: 'metadata-field-opaque', name: 'Margin', description: 'Profit margin', dataType: 'REAL',
      formula: 'SUM([Profit]) / SUM([Sales])', datasource: { id: 'ds-1', name: 'Published Sales' },
      upstreamFieldsConnection: connection([{ __typename: 'ColumnField', id: 'up-field', name: 'Profit', dataType: 'REAL' }, null]),
      upstreamColumnsConnection: connection([{ id: 'column-1', name: 'profit', table: { id: 'table-1', name: 'orders' } }]),
      downstreamSheetsConnection: connection([{ id: 'sheet-1', name: 'Executive', path: 'Executive', workbook: { id: 'wb-1', name: 'Finance' } }], true, 'sheet-next'),
      downstreamWorkbooksConnection: connection([{ __typename: 'Workbook', id: 'wb-1', name: 'Finance' }]),
      connection: { password: 'must-not-appear' },
    };
    const { metadata, queryMetadata } = metadataWith([fieldResponse(root)]);

    const result = await metadata.field(user, { fieldId: 'metadata-field-opaque' });

    expect(result.field).toMatchObject({
      id: 'metadata-field-opaque', type: 'CalculatedField', name: 'Margin', dataType: 'REAL',
      formula: 'SUM([Profit]) / SUM([Sales])', datasource: { id: 'ds-1', name: 'Published Sales' },
      upstream: { fields: [{ id: 'up-field', type: 'ColumnField', name: 'Profit', dataType: 'REAL' }], columns: [{ id: 'column-1', name: 'profit', table: { id: 'table-1', name: 'orders' } }] },
      downstream: { sheets: [{ id: 'sheet-1', name: 'Executive', workbook: { id: 'wb-1', name: 'Finance' } }], workbooks: [{ id: 'wb-1', type: 'Workbook', name: 'Finance' }] },
    });
    expect(result.truncated).toBe(true);
    expect(result.limitations.some((item) => item.includes('Downstream sheets'))).toBe(true);
    expect(JSON.stringify(result)).not.toContain('password');
    expect(queryMetadata.mock.calls[0]?.[1]).toBe(METADATA_FIELD_QUERY);
    expect(queryMetadata.mock.calls[0]?.[2]).toEqual({ filter: { id: 'metadata-field-opaque' }, first: 1 });
    expect(METADATA_FIELD_QUERY).toContain('permissionMode: FILTER_RESULTS');
  });

  it('omits null or redacted nodes and reports the omission explicitly', async () => {
    const root = {
      __typename: 'ColumnField', id: 'field-1', name: 'Region',
      upstreamFieldsConnection: connection([{ __typename: 'ColumnField', id: '[redacted]', name: 'hidden' }, {}]),
      upstreamColumnsConnection: null,
      downstreamSheetsConnection: connection([null, { id: '[redacted]', name: 'hidden' }]),
      downstreamWorkbooksConnection: connection([]),
    };
    const { metadata } = metadataWith([fieldResponse(root)]);

    const result = await metadata.field(user, { fieldId: 'field-1' });

    expect(result.field).toMatchObject({ id: 'field-1', upstream: { fields: [], columns: [] }, downstream: { sheets: [], workbooks: [] } });
    expect(result.limitations.some((item) => item.includes('omitted'))).toBe(true);
    expect(result.limitations.some((item) => item.includes('unavailable or redacted'))).toBe(true);
  });

  it('fails closed on GraphQL partial errors without leaking upstream messages', async () => {
    const partial = { data: { fieldsConnection: connection([]) }, errors: [{ message: 'SELECT password FROM secret_connection' }] };
    const { metadata } = metadataWith([partial, partial, partial]);

    await expect(metadata.search(user, {})).rejects.toMatchObject({ code: 'TABLEAU_METADATA_FAILED' });
    await expect(metadata.field(user, { fieldId: 'field-1' })).rejects.toMatchObject({ code: 'TABLEAU_METADATA_FAILED' });
    await expect(metadata.search(user, {})).rejects.not.toThrow('password');
  });

  it('rejects malformed, repeated, oversized, and over-bounded responses', async () => {
    const repeated = metadataWith([searchResponse([{ __typename: 'ColumnField', id: 'f1' }], true, 'same'), searchResponse([{ __typename: 'ColumnField', id: 'f2' }], true, 'same')]);
    await expect(repeated.metadata.search(user, {})).rejects.toMatchObject({ code: 'TABLEAU_METADATA_FAILED' });

    const emptyMore = metadataWith([searchResponse([], true, 'next')]);
    await expect(emptyMore.metadata.search(user, {})).rejects.toMatchObject({ code: 'TABLEAU_METADATA_FAILED' });

    const tooMany = metadataWith([searchResponse(Array.from({ length: 101 }, (_, index) => ({ __typename: 'ColumnField', id: `f${index}` })))]);
    await expect(tooMany.metadata.search(user, {})).rejects.toMatchObject({ code: 'TABLEAU_METADATA_FAILED' });

    const huge = metadataWith([{ data: { fieldsConnection: connection([{ __typename: 'ColumnField', id: 'f1', name: 'Huge', description: 'x'.repeat(1_050_000) }]) } }]);
    await expect(huge.metadata.search(user, {})).rejects.toMatchObject({ code: 'TABLEAU_RESPONSE_TOO_LARGE' });
  });

  it('preserves fatal identity and cancellation failures and enforces the ten-second deadline', async () => {
    const invalidated = metadataWith(() => { throw new TableauError('TABLEAU_SIGNIN_INVALIDATED'); });
    await expect(invalidated.metadata.search(user, {})).rejects.toMatchObject({ code: 'TABLEAU_SIGNIN_INVALIDATED' });

    const aborted = new AbortController();
    aborted.abort();
    const empty = metadataWith([]);
    await expect(empty.metadata.search(user, {}, aborted.signal)).rejects.toMatchObject({ code: 'TABLEAU_ABORTED' });

    vi.useFakeTimers();
    try {
      const hung = metadataWith(() => new Promise<never>(() => {}));
      const pending = hung.metadata.field(user, { fieldId: 'field-1' });
      const expectation = expect(pending).rejects.toMatchObject({ code: 'TABLEAU_TIMEOUT' });
      await vi.advanceTimersByTimeAsync(10_000);
      await expectation;
    } finally {
      vi.useRealTimers();
    }
  });
});
