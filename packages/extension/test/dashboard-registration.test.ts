import { afterEach, describe, expect, it, vi } from 'vitest';
import { ensureDashboardKey, registerDashboard } from '../src/tableau/dashboard-registration';
import type { Dashboard } from '../src/tableau/api';

const KEY = 'openvizpilot.dashboardRegistration';
const ID = 'dashboard:8b1fe8ce-23cb-4a19-9b18-17ed410a0422';
afterEach(() => vi.unstubAllGlobals());
function tableau(mode: string, stored?: string, save = vi.fn(async () => {})) {
  const values = new Map<string, string>();
  if (stored) values.set(KEY, stored);
  const settings = { get: (k: string) => values.get(k), set: (k: string, v: string) => values.set(k, v), saveAsync: save };
  vi.stubGlobal('tableau', { extensions: { environment: { mode }, settings } });
  return { settings, values, save };
}

describe('dashboard identity', () => {
  it('persists once in authoring, then reuses the identity for viewers', async () => {
    const { values, save } = tableau('authoring');
    const [a, b] = await Promise.all([ensureDashboardKey(), ensureDashboardKey()]);
    expect(a).toMatch(/^dashboard:/);
    expect(a).toBe(b);
    expect(values.get(KEY)).toBe(a);
    expect(save).toHaveBeenCalledTimes(1);
    tableau('viewing', a!);
    expect(await ensureDashboardKey()).toBe(a);
  });

  it('does not register a different dashboard per viewer when persistence is unavailable', async () => {
    const { save } = tableau('viewing');
    expect(await ensureDashboardKey()).toBeNull();
    expect(save).not.toHaveBeenCalled();
    const failed = tableau('authoring', undefined, vi.fn(async () => { throw new Error('not saved'); }));
    expect(await ensureDashboardKey()).toBeNull();
    expect(failed.values.get(KEY)).toBe('');
  });

  it('assigns different identities to two instances with the same name, and only resets in authoring', async () => {
    tableau('authoring');
    const a = await ensureDashboardKey();
    tableau('authoring');
    const b = await ensureDashboardKey();
    expect(a).not.toBe(b);
    tableau('viewing', ID);
    expect(await ensureDashboardKey(true)).toBeNull();
    tableau('authoring', ID);
    expect(await ensureDashboardKey(true)).not.toBe(ID);
  });

  it('preserves an existing assignment when reset cannot be saved', async () => {
    const { values } = tableau('authoring', ID, vi.fn(async () => { throw new Error('not saved'); }));
    expect(await ensureDashboardKey(true)).toBeNull();
    expect(values.get(KEY)).toBe(ID);
  });
});

describe('dashboard registration request', () => {
  it('sends only identity and name using the current login, without Tableau data or user IDs', async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetch);
    expect(await registerDashboard('https://middleware.example', 'session-token', ID, { name: 'Sales', worksheets: [] } as unknown as Dashboard)).toBe(true);
    expect(fetch).toHaveBeenCalledWith('https://middleware.example/api/dashboards', expect.objectContaining({
      method: 'POST', headers: { authorization: 'Bearer session-token', 'content-type': 'application/json' },
      body: JSON.stringify({ dashboardKey: ID, name: 'Sales' }),
    }));
  });
});
