import { afterEach, describe, expect, it, vi } from 'vitest';
import { isAllowedBackendUrl, loadSettings, saveSettings } from '../src/settings';

afterEach(() => vi.unstubAllGlobals());

function tableau(save = vi.fn(async () => {})) {
  const values = new Map<string, string>();
  const settings = { get: (k: string) => values.get(k), set: (k: string, v: string) => values.set(k, v), saveAsync: save };
  vi.stubGlobal('tableau', { extensions: { environment: {}, settings } });
  return { values, save };
}

describe('isAllowedBackendUrl', () => {
  it('localizes the reason for a malformed URL', () => {
    const result = isAllowedBackendUrl('not a url');
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('Not a valid absolute URL (expected: https://…).');
  });

  it('localizes the reason for a disallowed protocol', () => {
    const result = isAllowedBackendUrl('ftp://example.com');
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('Only HTTPS URLs (or http://localhost for development) are allowed.');
  });
});

describe('saveSettings', () => {
  const settings = { backendUrl: '', model: '', apiToken: '', dashboardContext: '' };

  it('reports a localized message and does not persist for an invalid backend URL', async () => {
    const { save } = tableau();
    const result = await saveSettings({ ...settings, backendUrl: 'ftp://example.com' });
    expect(result.persisted).toBe(false);
    expect(result.message).toBe('Backend URL not saved: Only HTTPS URLs (or http://localhost for development) are allowed.');
    expect(save).not.toHaveBeenCalled();
  });

  it('persists without a message when saveAsync succeeds (workbook save, authoring mode)', async () => {
    tableau();
    const result = await saveSettings(settings);
    expect(result).toEqual({ persisted: true });
  });

  it('falls back to a localized session-only message when saveAsync rejects (viewing mode)', async () => {
    tableau(vi.fn(async () => { throw new Error('not authoring'); }));
    const result = await saveSettings(settings);
    expect(result.persisted).toBe(false);
    expect(result.message).toBe('Settings apply only to this session (saving to the workbook is only possible in edit mode).');
  });
});

describe('loadSettings', () => {
  it('falls back to empty settings when the tableau global is unavailable', () => {
    vi.unstubAllGlobals();
    expect(loadSettings()).toEqual({ backendUrl: '', model: '', apiToken: '', dashboardContext: '' });
  });
});
