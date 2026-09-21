import { afterEach, describe, expect, it, vi } from 'vitest';
import { executeLookupMetric } from '../src/tools/executors/metrics';

afterEach(() => {
  vi.unstubAllGlobals();
});

const metric = {
  id: 'db2',
  name: 'Deckungsbeitrag II',
  synonyms: ['DB2', 'DB II', 'CM2'],
  definition: 'Umsatz − variable Kosten − fixe Kosten',
  owner: 'Controlling',
  datasource: 'Finance Semantic Model',
  interpretation: 'Unter 18 % kritisch',
  verifiedQuestions: [{ question: 'Wie hoch ist DB2?', answerGuidance: 'Wert aus der Definition ableiten.' }],
};

describe('executeLookupMetric', () => {
  it('formats a hit with the machine-readable "metric:" first line and the full record', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ metrics: [metric] }), { status: 200 })),
    );
    const result = await executeLookupMetric({ query: 'DB2' }, { baseUrl: 'https://backend.example' });
    expect(result.startsWith('metric: Deckungsbeitrag II\n')).toBe(true);
    expect(result).toContain('Synonyme: DB2, DB II, CM2');
    expect(result).toContain('Definition: Umsatz − variable Kosten − fixe Kosten');
    expect(result).toContain('Owner: Controlling');
    expect(result).toContain('Datenquelle: Finance Semantic Model');
    expect(result).toContain('Interpretation: Unter 18 % kritisch');
    expect(result).toContain('Wie hoch ist DB2?');
  });

  it('sends the query to POST /api/metrics/lookup with the bearer token', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ metrics: [] }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await executeLookupMetric({ query: 'DB2' }, { baseUrl: 'https://backend.example', apiToken: 'tok' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0];
    if (!call) throw new Error('fetch was not called');
    const [url, init] = call;
    if (!init) throw new Error('fetch was called without init');
    expect(url).toBe('https://backend.example/api/metrics/lookup');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer tok');
    expect(JSON.parse(init.body as string)).toEqual({ query: 'DB2' });
  });

  it('returns a "metric: none" text for an empty match array', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ metrics: [] }), { status: 200 })));
    const result = await executeLookupMetric({ query: 'Unbekannt' }, { baseUrl: 'https://backend.example' });
    expect(result.startsWith('metric: none\n')).toBe(true);
    expect(result).toContain('Keine Kennzahl im Katalog gefunden für „Unbekannt".');
  });

  it('returns "metric: none" on a non-OK HTTP response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })));
    const result = await executeLookupMetric({ query: 'DB2' }, { baseUrl: 'https://backend.example' });
    expect(result.startsWith('metric: none\n')).toBe(true);
  });

  it('returns "metric: none" on a network error (never throws)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      }),
    );
    const result = await executeLookupMetric({ query: 'DB2' }, { baseUrl: 'https://backend.example' });
    expect(result.startsWith('metric: none\n')).toBe(true);
  });
});
