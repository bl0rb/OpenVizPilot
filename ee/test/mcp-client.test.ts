import { afterEach, describe, expect, it, vi } from 'vitest';
import { executeMcpTool } from '../extension/src/mcp-client';

const call = { id: 'call-1', type: 'function' as const, function: { name: 'mcp__search__web', arguments: '{"query":"Berlin population"}' } };
const input = { call, dashboardKey: 'dashboard:11111111-1111-4111-8111-111111111111', baseUrl: '', apiToken: 'session', approval: { ticket: 'signed', destination: 'https://search.example/mcp' } };
afterEach(() => vi.unstubAllGlobals());

describe('MCP client consent', () => {
  it('sends nothing without a grant, consent or after cancellation', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const confirm = vi.fn(() => false);
    await executeMcpTool({ ...input, approval: undefined, confirm });
    expect(confirm).not.toHaveBeenCalled();
    await executeMcpTool({ ...input, confirm });
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Berlin population'));
    await executeMcpTool({ ...input, confirm: () => true, signal: AbortSignal.abort() });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('sends exact approved arguments and session token, never the chat history', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ content: 'Result with sources' }));
    vi.stubGlobal('fetch', fetcher);
    expect(await executeMcpTool({ ...input, confirm: () => true })).toBe('Result with sources');
    expect(fetcher.mock.calls[0]?.[0]).toBe('/api/mcp');
    const request = fetcher.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(request.headers).get('authorization')).toBe('Bearer session');
    expect(JSON.parse(String(request.body))).toEqual({ call, ticket: 'signed', dashboardKey: input.dashboardKey, approved: true });
  });
});