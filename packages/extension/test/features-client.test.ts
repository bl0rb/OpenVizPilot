import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchFeatures, NO_EE_FEATURES } from '../src/chat/features-client';

afterEach(() => vi.unstubAllGlobals());

describe('fetchFeatures', () => {
  it('maps every flag from /api/features, including tableauServer for the author site picker', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ features: { sso: true, tableauServer: true, serverData: 'yes' } }), { status: 200 })));
    expect(await fetchFeatures('https://mw.example', 'tok')).toEqual({ ...NO_EE_FEATURES, sso: true, tableauServer: true });
  });

  it('falls back to no features when the middleware refuses or is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 403 })));
    expect(await fetchFeatures('https://mw.example')).toEqual(NO_EE_FEATURES);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    expect(await fetchFeatures('https://mw.example')).toEqual(NO_EE_FEATURES);
  });
});
