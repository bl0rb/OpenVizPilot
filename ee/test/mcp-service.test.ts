import { describe, expect, it, vi } from 'vitest';
import type { McpSettings } from '../server/src/mcp/schema';
import { McpService, allowedMcpServers } from '../server/src/mcp/service';
import { McpGateway } from '../server/src/mcp/gateway';
import { createSqliteMcpStore } from '../server/src/mcp/store';
import { openSqliteDatabase } from '../../packages/server/src/memory/sqlite-store';
import { createLogger } from '../../packages/server/src/logger';

const dashboardKey = 'dashboard:11111111-1111-4111-8111-111111111111';
const settings: McpSettings = {
  sites: [{ id: 'sales', name: 'Sales', dashboardKeys: [dashboardKey], members: ['local:alice'] }],
  servers: [{ id: 'knowledge', name: 'Knowledge', url: 'https://knowledge.example/mcp', tools: ['search'], enabled: true, siteIds: ['sales'] }],
};
const call = { id: 'call-1', type: 'function' as const, function: { name: 'mcp__knowledge__search', arguments: '{"query":"Region"}' } };
const definitions = [{ type: 'function' as const, function: { name: call.function.name, description: 'Search', parameters: {} } }];

describe('Site-scoped MCP permissions', () => {
  it('requires explicit dashboard and verified member assignments', () => {
    expect(allowedMcpServers(settings, dashboardKey, 'local:alice')).toHaveLength(1);
    expect(allowedMcpServers(settings, dashboardKey, 'local:bob')).toEqual([]);
    expect(allowedMcpServers(settings, dashboardKey, 'oidc:alice')).toEqual([]);
    expect(allowedMcpServers(settings, dashboardKey, null)).toEqual([]);
    expect(allowedMcpServers(settings, 'another-dashboard', 'local:alice')).toEqual([]);
    expect(allowedMcpServers({ ...settings, servers: [{ ...settings.servers[0]!, enabled: false }] }, dashboardKey, 'local:alice')).toEqual([]);
  });

  it('honors revocation immediately and never trusts client-asserted identity', async () => {
    const db = openSqliteDatabase(':memory:');
    const store = createSqliteMcpStore(db);
    let licensed = true;
    const access = { principal: async (user: string) => `local:${user}`, hasFeature: async () => licensed, salt: async () => 'test-salt' };
    const gateway = new McpGateway([]);
    const execute = vi.spyOn(gateway, 'execute').mockResolvedValue('external result');
    vi.spyOn(gateway, 'definitions').mockResolvedValue(definitions);
    const service = new McpService(store, access, createLogger('error'), () => gateway);
    try {
      await store.setMcpSettings(settings, 0);
      expect(await service.catalogue(undefined, dashboardKey, new AbortController().signal)).toEqual([]);
      expect(await service.catalogue('bob', dashboardKey, new AbortController().signal)).toEqual([]);
      expect(await service.catalogue('alice', dashboardKey, new AbortController().signal)).toEqual(definitions);
      const approvals = await service.approvals('alice', dashboardKey, [call], definitions);
      const ticket = approvals[call.id]!.ticket;
      expect(await service.execute('alice', dashboardKey, call, ticket, new AbortController().signal)).toBe('external result');
      licensed = false;
      expect(await service.catalogue('alice', dashboardKey, new AbortController().signal)).toEqual([]);
      await expect(service.execute('alice', dashboardKey, call, ticket, new AbortController().signal)).rejects.toThrow('denied');
      licensed = true;
      await expect(service.execute('bob', dashboardKey, call, ticket, new AbortController().signal)).rejects.toThrow('denied');
      await store.setMcpSettings({ ...settings, servers: [{ ...settings.servers[0]!, url: 'https://changed.example/mcp' }] }, 1);
      await expect(service.execute('alice', dashboardKey, call, ticket, new AbortController().signal)).rejects.toThrow('revoked');
      await store.setMcpSettings({ ...settings, servers: [] }, 2);
      await expect(service.execute('alice', dashboardKey, call, ticket, new AbortController().signal)).rejects.toThrow('revoked');
      expect(execute).toHaveBeenCalledTimes(1);
    } finally {
      db.close();
    }
  });
});