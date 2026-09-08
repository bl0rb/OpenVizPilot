import { describe, expect, it } from 'vitest';
import { resolveMcpServer } from '../server/src/mcp/config';

const server = { id: 'knowledge', url: 'https://knowledge.example/mcp', tools: ['search'] };

describe('MCP configuration', () => {
  it('resolves only namespaced server-only secrets', () => {
    expect(resolveMcpServer({ ...server, tokenEnv: 'OVP_MCP_KEY' }, { OVP_MCP_KEY: 'secret' }))
      .toEqual({ ...server, tokenEnv: 'OVP_MCP_KEY', token: 'secret' });
    expect(() => resolveMcpServer({ ...server, tokenEnv: 'LITELLM_API_KEY' }, { LITELLM_API_KEY: 'secret' })).toThrow();
  });

  it.each(['http://example.com/mcp', 'https://user:secret@example.com/mcp', 'https://example.com/mcp?key=secret', 'https://example.com/mcp#fragment'])('rejects unsafe endpoint %s', (url) => {
    expect(() => resolveMcpServer({ ...server, url }, {})).toThrow();
  });

  it('rejects missing credentials', () => {
    expect(() => resolveMcpServer({ ...server, tokenEnv: 'OVP_MCP_MISSING' }, {})).toThrow('credential unavailable');
  });
});