import { getCurrentLocale, setLocaleOverride } from '@openvizpilot/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { chooseLocale, loadStoredLocale, LOCALE_STORAGE_KEY } from '../src/locale';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    data,
  };
}

describe('extension language', () => {
  afterEach(() => setLocaleOverride(null));

  it('asks on first start (nothing stored) and ignores unknown values', () => {
    expect(loadStoredLocale(memoryStorage())).toBeNull();
    expect(loadStoredLocale(memoryStorage({ [LOCALE_STORAGE_KEY]: 'fr' }))).toBeNull();
    expect(loadStoredLocale(null)).toBeNull();
    expect(loadStoredLocale({ getItem: () => { throw new Error('blocked'); } })).toBeNull();
  });

  it('stores the choice and applies it immediately', () => {
    const storage = memoryStorage();
    chooseLocale('de', storage);
    expect(storage.data.get(LOCALE_STORAGE_KEY)).toBe('de');
    expect(getCurrentLocale()).toBe('de');
    expect(loadStoredLocale(storage)).toBe('de');
  });

  it('still applies the choice for this session when storage is unavailable', () => {
    chooseLocale('en', { setItem: () => { throw new Error('blocked'); } });
    expect(getCurrentLocale()).toBe('en');
  });
});
