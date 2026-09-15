import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { loadEnv } from '../src/env';
import { testLicenseEnv } from './license-helper';

const instances: ReturnType<typeof createApp>[] = [];
afterEach(async () => {
  for (const instance of instances.splice(0)) {
    instance.stopHeartbeat();
    await instance.memoryStore?.close();
  }
});

function setup(licensed = false) {
  const config = loadEnv({ LITELLM_BASE_URL: 'http://127.0.0.1:1', LITELLM_API_KEY: 'test', DEFAULT_MODEL: 'test',
    ADMIN_TOKEN: 'test-admin', MEMORY_DB_PATH: ':memory:', LOG_LEVEL: 'error',
    ...(licensed ? testLicenseEnv(['tableauServer', 'sso']) : {}),
  });
  config.telemetryEndpoint = '';
  const result = createApp(config);
  instances.push(result);
  return result.app;
}

describe('Tableau routes in the assembled app', () => {
  it('requires admin authorization for every configuration operation', async () => {
    const app = setup();
    for (const [path, method] of [['', 'GET'], ['', 'PUT'], ['', 'DELETE'], ['/check', 'POST']]) {
      const response = await app.request(`/api/admin/tableau-server${path}`, { method });
      expect(response.status).toBe(401);
    }
    const response = await app.request('/api/admin/tableau-server', { headers: { authorization: 'Bearer test-admin' } });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ config: null, revision: null, secretConfigured: false, licensed: false, oidcReady: false });
  });

  it('requires personal approval in addition to license entitlement', async () => {
    const app = setup(true);
    const response = await app.request('/api/features');
    expect((await response.json() as { features: { tableauServer: boolean } }).features.tableauServer).toBe(false);
    for (const endpoint of ['check', 'search', 'metadata/search', 'metadata/field']) {
      const check = await app.request(`/api/tableau-server/${endpoint}`, { method: 'POST', headers: { authorization: 'Bearer test-admin' },
        body: JSON.stringify({ username: 'admin', claims: { upn: 'admin' } }),
      });
      expect(check.status).toBe(403);
      expect((await check.json() as { code: string }).code).toBe('approval_required');
      expect(check.headers.get('cache-control')).toBe('no-store');
    }
  });

  it('preserves ordinary core routes with no active Tableau configuration', async () => {
    const app = setup();
    expect((await app.request('/healthz')).status).toBe(200);
    expect((await app.request('/api/session')).status).toBe(200);
    expect((await app.request('/admin')).status).toBe(200);
  });
});
