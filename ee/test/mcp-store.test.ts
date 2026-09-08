import { describe, expect, it } from 'vitest';
import { mcpSettingsSchema } from '../server/src/mcp/schema';
import { createSqliteMcpStore } from '../server/src/mcp/store';
import { openSqliteDatabase } from '../../packages/server/src/memory/sqlite-store';

const dashboardKey = 'dashboard:11111111-1111-4111-8111-111111111111';
const settings = {
  sites: [{ id: 'sales', name: 'Sales', dashboardKeys: [dashboardKey], members: ['alice'] }],
  servers: [{ id: 'knowledge', name: 'Knowledge', url: 'https://knowledge.example/mcp', tools: ['search'], enabled: true, siteIds: ['sales'] }],
};

describe('MCP administration persistence', () => {
  it('persists sites and servers and prevents stale updates', async () => {
    const db = openSqliteDatabase(':memory:');
    const store = createSqliteMcpStore(db);
    try {
      expect(await store.getMcpSettings()).toEqual({ settings: { sites: [], servers: [] }, revision: 0 });
      expect(await store.setMcpSettings(settings, 0)).toBe(true);
      expect(await store.getMcpSettings()).toEqual({ settings, revision: 1 });
      expect(await store.setMcpSettings({ sites: [], servers: [] }, 0)).toBe(false);
      expect((await store.getMcpSettings()).settings).toEqual(settings);
    } finally {
      db.close();
    }
  });

  it('rejects ambiguous dashboard assignments and unknown sites', () => {
    expect(mcpSettingsSchema.safeParse({ ...settings, sites: [...settings.sites, { ...settings.sites[0], id: 'other' }] }).success).toBe(false);
    expect(mcpSettingsSchema.safeParse({ ...settings, servers: [{ ...settings.servers[0], siteIds: ['unknown'] }] }).success).toBe(false);
    expect(mcpSettingsSchema.safeParse({ ...settings, servers: [{ ...settings.servers[0], tokenEnv: 'LITELLM_API_KEY' }] }).success).toBe(false);
  });
});