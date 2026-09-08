import { describe, expect, it, vi } from 'vitest';
import { McpGateway } from '../server/src/mcp/gateway';
import { McpGrants } from '../server/src/mcp/grants';

const call = { id: 'call-1', type: 'function' as const, function: { name: 'mcp__knowledge__search', arguments: '{"query":"Region"}' } };
const config = [{ id: 'knowledge', url: 'https://knowledge.example/mcp', token: 'server-secret', tools: ['search', 'write'] }];

function fixture(options: { readOnly?: boolean; isError?: boolean; oversized?: boolean; session?: boolean } = {}) {
  const requests: Array<Record<string, unknown>> = [];
  const fetcher = vi.fn(async (_input: unknown, init?: RequestInit) => {
    if (init?.method === 'GET') return new Response(null, { status: 405 });
    if (init?.method === 'DELETE') {
      requests.push({ method: 'session/delete' });
      return new Response(null, { status: 200 });
    }
    const request = JSON.parse(String(init?.body)) as Record<string, unknown>;
    requests.push(request);
    if (!('id' in request)) return new Response(null, { status: 202 });
    let result: unknown;
    if (request.method === 'initialize') {
      result = { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1' } };
    } else if (request.method === 'tools/list') {
      result = { tools: [
        { name: 'search', description: 'Search', annotations: { readOnlyHint: options.readOnly ?? true }, inputSchema: { type: 'object', properties: { query: { type: 'string', maxLength: 100 } }, required: ['query'], additionalProperties: false } },
        { name: 'write', annotations: { readOnlyHint: false }, inputSchema: { type: 'object' } },
        { name: 'unapproved', annotations: { readOnlyHint: true }, inputSchema: { type: 'object' } },
      ] };
    } else {
      result = { isError: options.isError, content: [{ type: 'text', text: options.oversized ? 'x'.repeat(300_000) : 'Source: https://example.org/report' }] };
    }
    return Response.json({ jsonrpc: '2.0', id: request.id, result }, { headers: options.session && request.method === 'initialize' ? { 'Mcp-Session-Id': 'fixture-session' } : {} });
  });
  return { requests, fetcher, gateway: new McpGateway(config, fetcher) };
}

describe('MCP gateway using the real SDK', () => {
  it('terminates remote sessions after completing an operation', async () => {
    const { gateway, requests } = fixture({ session: true });
    await gateway.execute(call, new AbortController().signal);
    expect(requests.at(-1)).toEqual({ method: 'session/delete' });
  });

  it('discovers only approved read-only tools and executes validated arguments', async () => {
    const { gateway, requests, fetcher } = fixture();
    expect((await gateway.definitions(new AbortController().signal)).map((tool) => tool.function.name)).toEqual([call.function.name]);
    const result = JSON.parse(await gateway.execute(call, new AbortController().signal));
    expect(result).toMatchObject({ source: 'knowledge', content: 'Source: https://example.org/report', truncated: false });
    expect(requests.find((request) => request.method === 'tools/call')).toMatchObject({ params: { name: 'search', arguments: { query: 'Region' } } });
    expect(fetcher.mock.calls.every(([, init]) => init?.redirect === 'error')).toBe(true);
    expect(new Headers(fetcher.mock.calls[0]?.[1]?.headers).get('authorization')).toBe('Bearer server-secret');
  });

  it('does not invoke unapproved tools or invalid arguments', async () => {
    const { gateway, requests } = fixture();
    await expect(gateway.execute({ ...call, function: { ...call.function, arguments: '{"url":"https://evil.example"}' } }, new AbortController().signal)).rejects.toThrow('Invalid MCP arguments');
    await expect(gateway.execute({ ...call, function: { ...call.function, name: 'mcp__knowledge__unknown' } }, new AbortController().signal)).rejects.toThrow('denied');
    expect(requests.some((request) => request.method === 'tools/call')).toBe(false);
  });

  it('rechecks read-only status and rejects remote failures and oversized responses', async () => {
    for (const options of [{ readOnly: false }, { isError: true }, { oversized: true }]) {
      await expect(fixture(options).gateway.execute(call, new AbortController().signal)).rejects.toThrow();
    }
  });

  it('keeps dashboard chat available if a source fails discovery', async () => {
    const gateway = new McpGateway(config, async () => { throw new Error('secret upstream error'); });
    expect(await gateway.definitions(new AbortController().signal)).toEqual([]);
  });
});

describe('MCP execution grants', () => {
  it('binds short-lived grants to exact arguments and the authenticated principal', () => {
    const grants = new McpGrants('test-secret');
    const ticket = grants.issue(call, 'alice', 1000);
    expect(grants.verify(ticket, call, 'alice', 2000)).toBe(true);
    expect(grants.verify(ticket, call, 'bob', 2000)).toBe(false);
    expect(grants.verify(ticket, { ...call, function: { ...call.function, arguments: '{}' } }, 'alice', 2000)).toBe(false);
    expect(grants.verify(ticket, call, 'alice', 121000)).toBe(false);
    expect(grants.verify(`${ticket}x`, call, 'alice', 2000)).toBe(false);
    expect(grants.verify('invalid', call, 'alice', 2000)).toBe(false);
  });
});