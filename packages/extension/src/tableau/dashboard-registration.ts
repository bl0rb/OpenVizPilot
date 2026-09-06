import type { Dashboard, Settings } from './api';
import { getTableau } from './api';
import { registeredDashboardKeySchema } from '@openvizpilot/shared';

const KEY = 'openvizpilot.dashboardRegistration';
const pending = new WeakMap<Settings, Promise<string | null>>();

/** Persisted per extension instance in the workbook, shared by all its viewers.
 * Never generate a browser-local identity: that would create one dashboard per user.
 * Copied workbooks retain their assignment until the author explicitly resets it.
 */
export async function ensureDashboardKey(reset = false): Promise<string | null> {
  const { settings, environment } = getTableau().extensions;
  const running = pending.get(settings);
  if (running) return running;
  const saved = settings.get(KEY);
  if (!reset && registeredDashboardKeySchema.safeParse(saved).success) return saved!;
  if (environment.mode !== 'authoring') return null;
  const work = (async () => {
    const key = `dashboard:${crypto.randomUUID()}`;
    settings.set(KEY, key);
    try {
      await settings.saveAsync();
      return key;
    } catch {
      settings.set(KEY, saved ?? '');
      return null;
    }
  })();
  pending.set(settings, work);
  try { return await work; } finally { pending.delete(settings); }
}

export async function registerDashboard(baseUrl: string, apiToken: string | undefined, key: string, dashboard: Dashboard): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl}/api/dashboards`, {
      method: 'POST',
      signal: AbortSignal.timeout(10_000),
      headers: { 'content-type': 'application/json', ...(apiToken ? { authorization: `Bearer ${apiToken}` } : {}) },
      body: JSON.stringify({ dashboardKey: key, name: dashboard.name.slice(0, 200) }),
    });
    return response.ok;
  } catch { return false; }
}
