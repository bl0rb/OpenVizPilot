import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { AuthVariables } from '@openvizpilot/ee/server';
import type { MemoryStore } from '../src/memory/store';
import { requireUserAccess } from '../src/user-access';
import { createLogger } from '../src/logger';

function fixture(identity: 'local' | 'oidc' | 'none' = 'local') {
  const grants = { ai: false, tableauApi: false };
  const store = {
    getUserAuth: vi.fn(async () => ({ displayName: 'Anna', disabled: false })),
    ensureUserAccess: vi.fn(async () => ({ ...grants })),
  };
  const app = new Hono<AuthVariables>();
  app.use('*', async (c, next) => {
    if (identity !== 'none') c.set('authUser', 'anna');
    if (identity === 'oidc') c.set('oidcUser', { issuer: 'https://idp.example', sub: 'anna', name: 'Anna', email: 'anna@example.test', claims: {}, expiresAt: Date.now() + 60_000 });
    await next();
  });
  app.use('*', requireUserAccess(store as unknown as MemoryStore, createLogger('error')));
  app.all('*', c => c.json({ access: c.get('userAccess') }));
  return { app, store, grants };
}

describe('per-user capability approvals', () => {
  it('keeps pending sessions readable but gates all AI entry points', async () => {
    const { app } = fixture();
    const session = await app.request('/api/session');
    expect(session.status).toBe(200);
    expect(session.headers.get('cache-control')).toBe('no-store');
    for (const path of ['/api/chat', '/api/chat/', '/api/models', '/api/mcp/execute', '/api/memory/prefs']) {
      const response = await app.request(path);
      expect(response.status, path).toBe(403);
      expect(await response.json()).toMatchObject({ code: 'approval_required', capability: 'ai' });
    }
  });

  it('enforces independent grants and rereads revocations on the next request', async () => {
    const { app, grants } = fixture();
    grants.tableauApi = true;
    expect((await app.request('/api/tableau-server/metadata/field')).status).toBe(200);
    expect((await app.request('/api/chat')).status).toBe(403);
    grants.ai = true;
    grants.tableauApi = false;
    expect((await app.request('/api/chat')).status).toBe(200);
    expect((await app.request('/api/tableau-server/search')).status).toBe(403);
    grants.ai = false;
    expect((await app.request('/api/chat')).status).toBe(403);
  });

  it('uses verified issuer and subject, never supplied headers or body grants', async () => {
    const { app, store } = fixture('oidc');
    await app.request('/api/chat', { method: 'POST', headers: { 'x-tableau-user': 'admin', 'content-type': 'application/json' }, body: JSON.stringify({ ai: true }) });
    expect(store.ensureUserAccess).toHaveBeenCalledWith(expect.objectContaining({ provider: 'oidc', issuer: 'https://idp.example', subject: 'anna' }));
    expect(store.getUserAuth).not.toHaveBeenCalled();
  });

  it('does not grant shared/anonymous identities and fails closed on storage errors', async () => {
    const anonymous = fixture('none');
    expect((await anonymous.app.request('/api/chat')).status).toBe(403);
    expect((await anonymous.app.request('/api/tableau-server/search')).status).toBe(403);
    expect(anonymous.store.ensureUserAccess).not.toHaveBeenCalled();
    const { app, store } = fixture();
    store.ensureUserAccess.mockRejectedValueOnce(new Error('database secret'));
    const response = await app.request('/api/chat');
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('database secret');
  });

  it('requires AI approval for anonymous memory access even with a Tableau user header', async () => {
    const { app, store } = fixture('none');
    const response = await app.request('/api/memory', { headers: { 'x-tableau-user': 'ci' } });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: 'approval_required', capability: 'ai' });
    expect(store.ensureUserAccess).not.toHaveBeenCalled();
  });
});
