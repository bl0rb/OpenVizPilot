import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadPrefs } from '../extension/src/prefs-client';

afterEach(() => {
  vi.unstubAllGlobals();
});

// UI-Review P1-4: ein Ladefehler (Netzwerk/HTTP/Format) darf nicht wie
// "nichts gespeichert" aussehen — loadPrefs muss die beiden Fälle trennen.
describe('loadPrefs', () => {
  it('returns null when the server confirms there are no saved prefs', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ prefs: null }), { status: 200 })));
    await expect(loadPrefs('https://backend.example', undefined, 'user-1', 'Dashboard')).resolves.toBeNull();
  });

  it('returns the parsed prefs on success', async () => {
    const prefs = { focus: 'kurz', questions: ['Wie lief Q3?'] };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ prefs }), { status: 200 })));
    await expect(loadPrefs('https://backend.example', undefined, 'user-1', 'Dashboard')).resolves.toEqual(prefs);
  });

  it('throws on a network error instead of returning null', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      }),
    );
    await expect(loadPrefs('https://backend.example', undefined, 'user-1', 'Dashboard')).rejects.toThrow();
  });

  it('throws on a non-OK HTTP status instead of returning null', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 500 })));
    await expect(loadPrefs('https://backend.example', undefined, 'user-1', 'Dashboard')).rejects.toThrow();
  });

  it('throws on a schema-invalid response instead of returning null', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ prefs: { focus: 123 } }), { status: 200 })),
    );
    await expect(loadPrefs('https://backend.example', undefined, 'user-1', 'Dashboard')).rejects.toThrow();
  });
});
