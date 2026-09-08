import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type OpenAI from 'openai';
import type { AuthVariables } from '../server/src/auth-routes';
import { McpService } from '../server/src/mcp/service';
import { createSqliteMcpStore } from '../server/src/mcp/store';
import { McpGateway } from '../server/src/mcp/gateway';
import { createChatRoute } from '../../packages/server/src/routes/chat';
import { openSqliteDatabase } from '../../packages/server/src/memory/sqlite-store';
import { loadEnv } from '../../packages/server/src/env';
import { createLogger } from '../../packages/server/src/logger';

describe('MCP chat integration', () => {
  it('offers only licensed site tools and emits user-bound approvals outside model history', async () => {
    const db = openSqliteDatabase(':memory:');
    const store = createSqliteMcpStore(db);
    const dashboardKey = 'dashboard:11111111-1111-4111-8111-111111111111';
    const externalName = 'mcp__knowledge__search';
    const gateway = new McpGateway([]);
    vi.spyOn(gateway, 'definitions').mockResolvedValue([{ type: 'function', function: { name: externalName, description: 'Search', parameters: { type: 'object' } } }]);
    let licensed = true;
    const hasFeature = async () => licensed;
    const service = new McpService(store, { hasFeature, principal: async (user) => `local:${user}`, salt: async () => 'test-salt' }, createLogger('error'), () => gateway);
    const create = vi.fn(async function* (_request: unknown) {
      yield { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call-1', type: 'function', function: { name: externalName, arguments: '{"query":"Berlin"}' } }] }, finish_reason: null }] };
      yield { choices: [{ delta: {}, finish_reason: 'tool_calls' }] };
    });
    const client = { chat: { completions: { create } } } as unknown as OpenAI;
    const config = loadEnv({ LITELLM_BASE_URL: 'http://localhost:9', LITELLM_API_KEY: 'test', DEFAULT_MODEL: 'test', SCOPE_GUARD: 'off' });
    const app = new Hono<AuthVariables>();
    app.use('*', async (context, next) => { context.set('authUser', 'alice'); await next(); });
    app.route('/chat', createChatRoute(config, createLogger('error'), client, null, null, hasFeature, service));
    const request = () => app.request('/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ context: '# Map', dashboardKey, userId: 'forged-bob', messages: [{ role: 'user', content: 'Recherche zu Berlin' }] }) });
    try {
      await store.setMcpSettings({ sites: [{ id: 'sales', name: 'Sales', dashboardKeys: [dashboardKey], members: ['local:alice'] }], servers: [{ id: 'knowledge', name: 'Knowledge', url: 'https://knowledge.example/mcp', tools: ['search'], enabled: true, siteIds: ['sales'] }] }, 0);
      const text = await (await request()).text();
      expect(text).toContain('"external":{"call-1":{"ticket":');
      const body = create.mock.calls[0]?.[0] as unknown as { tools: Array<{ function: { name: string } }>; messages: Array<{ content: string }> };
      expect(body.tools.some((tool) => tool.function.name === externalName)).toBe(true);
      expect(body.tools.some((tool) => tool.function.name === 'get_selected_marks')).toBe(true);
      expect(body.messages[0]?.content).toContain('EXTERNE QUELLEN');
      licensed = false;
      expect(await (await request()).text()).not.toContain('"external":');
      const unlicensed = create.mock.calls[1]?.[0] as unknown as typeof body;
      expect(unlicensed.tools.some((tool) => tool.function.name.startsWith('mcp__'))).toBe(false);
    } finally {
      db.close();
    }
  });
});