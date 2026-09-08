import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../packages/server/src/app';
import { loadEnv } from '../../packages/server/src/env';
import { testLicenseEnv } from '../../packages/server/test/license-helper';
import { hashSessionToken } from '../../packages/server/src/admin-auth';
import { adminPageHtml } from '../../packages/server/src/admin-page';

const dashboardKey = 'dashboard:11111111-1111-4111-8111-111111111111';
const settings = { sites: [{ id: 'sales', name: 'Sales', dashboardKeys: [dashboardKey], members: ['local:alice'] }], servers: [{ id: 'knowledge', name: 'Knowledge', url: 'https://knowledge.example/mcp', tools: ['search'], enabled: true, siteIds: ['sales'] }] };

async function withApp(licensed: boolean, run: (instance: ReturnType<typeof createApp>) => Promise<void>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ovp-mcp-admin-'));
  const config = loadEnv({ LITELLM_BASE_URL: 'http://localhost:9', LITELLM_API_KEY: 'test', DEFAULT_MODEL: 'test', ADMIN_TOKEN: 'test-admin', AUTH_MODE: 'local', MEMORY_DB_PATH: path.join(dir, 'db.sqlite'), ...testLicenseEnv(licensed ? ['mcp'] : ['memory']) });
  const instance = createApp({ ...config, telemetryEndpoint: '' });
  try {
    await instance.memoryStore!.registerDashboard({ dashboardKey, name: 'Sales dashboard' });
    await instance.memoryStore!.createUser('alice', 'Alice', 'unused');
    await instance.memoryStore!.createUserSession(hashSessionToken('user-session'), 'alice', Date.now() + 60_000);
    await run(instance);
  } finally {
    instance.stopHeartbeat();
    await instance.memoryStore?.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const adminHeaders = { authorization: 'Bearer test-admin', 'content-type': 'application/json' };

describe('Enterprise MCP administration', () => {
  it('renders syntactically valid admin scripts and labeled site/server controls', () => {
    const script = adminPageHtml.match(/<script>([\s\S]*)<\/script>/)?.[1];
    expect(script).toBeTruthy();
    expect(() => new Function(script!)).not.toThrow();
    expect(adminPageHtml).toContain('id="mcp-admin"');
    expect(adminPageHtml).toContain('Freigaben speichern');
  });

  it('requires admin authentication and persists site-scoped configuration', async () => {
    await withApp(true, async ({ app }) => {
      expect((await app.request('/api/admin/mcp')).status).toBe(401);
      expect((await app.request('/api/admin/mcp', { headers: { authorization: 'Bearer user-session' } })).status).toBe(401);
      const initial = await (await app.request('/api/admin/mcp', { headers: adminHeaders })).json();
      expect(initial).toMatchObject({ revision: 0, settings: { servers: [], sites: [] }, users: [{ id: 'local:alice' }] });
      const update = () => app.request('/api/admin/mcp', { method: 'PUT', headers: adminHeaders, body: JSON.stringify({ settings, revision: 0 }) });
      expect((await update()).status).toBe(200);
      expect((await update()).status).toBe(409);
      const saved = await (await app.request('/api/admin/mcp', { headers: adminHeaders })).json();
      expect(saved).toMatchObject({ settings, revision: 1 });
      const badProbe = await app.request('/api/admin/mcp/probe', { method: 'POST', headers: adminHeaders, body: JSON.stringify({ id: 'test', url: 'http://localhost/mcp' }) });
      expect(badProbe.status).toBe(400);
    });
  });

  it('blocks admin discovery, changes and execution without the MCP license', async () => {
    await withApp(false, async ({ app }) => {
      expect((await app.request('/api/admin/mcp', { headers: adminHeaders })).status).toBe(402);
      expect((await app.request('/api/admin/mcp', { method: 'PUT', headers: adminHeaders, body: JSON.stringify({ settings, revision: 0 }) })).status).toBe(402);
      expect((await app.request('/api/admin/mcp/probe', { method: 'POST', headers: adminHeaders, body: JSON.stringify({ id: 'test', url: 'https://example.com/mcp' }) })).status).toBe(402);
      const result = await app.request('/api/mcp', { method: 'POST', headers: { authorization: 'Bearer user-session', 'content-type': 'application/json' }, body: JSON.stringify({ dashboardKey, approved: true, ticket: 'invalid', call: { id: 'call', type: 'function', function: { name: 'mcp__knowledge__search', arguments: '{}' } } }) });
      expect(result.status).toBe(402);
    });
  });
});