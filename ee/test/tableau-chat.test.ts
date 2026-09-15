import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolCall } from '@openvizpilot/shared';
import { executeTableauTool } from '../extension/src/tableau-client';

const call = (args: string): ToolCall => ({
  id: 'tableau-call', type: 'function', function: { name: 'tableau_server_search', arguments: args },
});

const namedCall = (name: string, args: string): ToolCall => ({
  id: 'tableau-call', type: 'function', function: { name, arguments: args },
});

afterEach(() => vi.restoreAllMocks());

describe('tableau chat tool dispatch', () => {
  it('does not broaden malformed arguments into an unfiltered search', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    for (const [name, args] of [
      ['tableau_server_search', 'not-json'], ['tableau_metadata_search', 'null'],
      ['tableau_metadata_field', JSON.stringify({})], ['tableau_metadata_field', JSON.stringify({ fieldId: 'x'.repeat(201) })],
    ] as Array<[string, string]>) {
      const result = await executeTableauTool({ call: namedCall(name, args), baseUrl: '' });
      expect(JSON.parse(result)).toHaveProperty('error');
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not treat prototype property names as Tableau tools', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    for (const name of ['toString', 'constructor', '__proto__']) {
      const result = await executeTableauTool({ call: namedCall(name, '{}'), baseUrl: '' });
      expect(JSON.parse(result)).toEqual({ error: 'Unbekanntes Tool.' });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('dispatches metadata search and opaque field detail to their allowlisted endpoints', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ items: [] }), { status: 200 }));
    await executeTableauTool({
      call: namedCall('tableau_metadata_search', JSON.stringify({ query: 'margin', datasourceId: 'ds-1', limit: 7, user: 'drop' })),
      baseUrl: 'https://backend.example.test', apiToken: 'oidc-token',
    });
    await executeTableauTool({
      call: namedCall('tableau_metadata_field', JSON.stringify({ fieldId: 'field-1', query: 'drop' })),
      baseUrl: 'https://backend.example.test', apiToken: 'oidc-token',
    });
    expect(fetchMock.mock.calls[0]![0]).toBe('https://backend.example.test/api/tableau-server/metadata/search');
    expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string)).toEqual({ query: 'margin', datasourceId: 'ds-1', limit: 7 });
    expect(fetchMock.mock.calls[1]![0]).toBe('https://backend.example.test/api/tableau-server/metadata/field');
    expect(JSON.parse(fetchMock.mock.calls[1]![1]!.body as string)).toEqual({ fieldId: 'field-1' });
  });

  it('posts only the supported search arguments with the current API token', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      source: 'tableau-server', retrievedAt: '2026-09-15T10:00:00Z', items: [], truncated: false, scanned: 0, limitations: [],
    }), { status: 200, headers: { 'content-type': 'application/json' } }));

    const result = await executeTableauTool({
      call: call(JSON.stringify({ query: 'sales', type: 'view', limit: 5, user: 'must-not-forward' })),
      baseUrl: 'https://backend.example.test', apiToken: 'oidc-token',
    });

    expect(fetchMock).toHaveBeenCalledWith('https://backend.example.test/api/tableau-server/search', expect.objectContaining({
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer oidc-token' },
      body: JSON.stringify({ query: 'sales', type: 'view', limit: 5 }),
    }));
    expect(result).not.toContain('oidc-token');
    expect(JSON.parse(result)).toMatchObject({ source: 'tableau-server', items: [] });
  });

  it('returns valid bounded JSON and does not expose endpoint error bodies', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('upstream token: secret', { status: 502 }));
    const error = await executeTableauTool({ call: call('{}'), baseUrl: '' });
    expect(JSON.parse(error)).toEqual({ error: 'Tableau-Suche derzeit nicht verfügbar.' });
    expect(error).not.toContain('secret');

    const items = Array.from({ length: 100 }, (_, index) => ({ name: `${index}-${'x'.repeat(500)}` }));
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ source: 'server', items, truncated: false }), { status: 200 }));
    const bounded = await executeTableauTool({ call: call('{}'), baseUrl: '' });
    expect(bounded.length).toBeLessThanOrEqual(20_000);
    expect(JSON.parse(bounded)).toMatchObject({ truncated: true });

    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      source: 'Tableau Server', fieldId: 'field-1', formula: 'SUM(' + 'x'.repeat(25_000) + ')',
      datasource: { id: 'ds-1' }, downstreamSheets: [], downstreamWorkbooks: [],
    }), { status: 200 }));
    const detail = await executeTableauTool({
      call: namedCall('tableau_metadata_field', JSON.stringify({ fieldId: 'field-1' })), baseUrl: '',
    });
    expect(detail.length).toBeLessThanOrEqual(20_000);
    expect(JSON.parse(detail)).toMatchObject({ source: 'Tableau Metadata API', truncated: true, field: null });
    expect(detail).not.toContain('x'.repeat(100));
  });

  it('keeps REST fallback provenance without inventing a scanned count', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ description: 'x'.repeat(25_000), items: [] })));
    const result = JSON.parse(await executeTableauTool({ call: call('{}'), baseUrl: '' }));
    expect(result).toMatchObject({ source: 'Tableau Server', truncated: true, items: [] });
    expect(result).not.toHaveProperty('scanned');
  });

  it('propagates cancellation to fetch', async () => {
    const controller = new AbortController();
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((_input, init) => {
      expect(init?.signal).toBe(controller.signal);
      return Promise.reject(new DOMException('Aborted', 'AbortError'));
    });
    controller.abort();
    await expect(executeTableauTool({ call: call('{}'), baseUrl: '', signal: controller.signal })).rejects.toThrow('Aborted');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
