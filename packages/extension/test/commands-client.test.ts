import { DEFAULT_SLASH_COMMANDS, type SlashCommand } from '@openvizpilot/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadSlashCommands, sendUsageEvents } from '../src/chat/commands-client';

afterEach(() => {
  vi.unstubAllGlobals();
});

const customCommands: SlashCommand[] = [
  { name: 'kurz', description: 'Kurze Antwort', template: 'Antworte in maximal zwei Sätzen.' },
];

describe('loadSlashCommands', () => {
  it('returns the server-configured commands on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ commands: customCommands }), { status: 200 })),
    );
    const result = await loadSlashCommands('https://backend.example', 'token');
    expect(result).toEqual({ commands: customCommands, starters: [] });
  });

  it('passes the dashboard key and returns the playbook starters', async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify({ commands: customCommands, starters: ['Wie lief Q3?', '', 42] }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const result = await loadSlashCommands('https://backend.example', undefined, 'Rentabilität (Alle)');
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://backend.example/api/commands?dashboardKey=Rentabilit%C3%A4t%20(Alle)');
    // Nur nicht-leere Strings, Unsinn wird verworfen.
    expect(result.starters).toEqual(['Wie lief Q3?']);
    expect(result.commands).toEqual(customCommands);
  });

  it('falls back to defaults on a network error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      }),
    );
    const result = await loadSlashCommands('https://backend.example');
    expect(result).toEqual({ commands: DEFAULT_SLASH_COMMANDS, starters: [] });
  });

  it('falls back to defaults on a non-OK HTTP status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })));
    const result = await loadSlashCommands('https://backend.example');
    expect(result).toEqual({ commands: DEFAULT_SLASH_COMMANDS, starters: [] });
  });

  it('falls back to defaults on a schema-invalid response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ commands: [{ name: 'Ungültig Name' }] }), { status: 200 })),
    );
    const result = await loadSlashCommands('https://backend.example');
    expect(result).toEqual({ commands: DEFAULT_SLASH_COMMANDS, starters: [] });
  });
});

describe('sendUsageEvents', () => {
  it('posts events with the auth header and no user identifier', () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    sendUsageEvents('https://backend.example', 'token', [{ metric: 'slash_command', key: 'vergleich' }]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0];
    if (!call) throw new Error('fetch was not called');
    const [url, init] = call;
    if (!init) throw new Error('fetch was called without init');
    expect(url).toBe('https://backend.example/api/stats');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer token');
    expect(JSON.parse(init.body as string)).toEqual({
      events: [{ metric: 'slash_command', key: 'vergleich' }],
    });
  });

  it('does nothing for an empty event list', () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    sendUsageEvents('https://backend.example', undefined, []);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('swallows network errors silently', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      }),
    );
    expect(() =>
      sendUsageEvents('https://backend.example', undefined, [{ metric: 'action_executed', key: 'apply_filter' }]),
    ).not.toThrow();
  });
});
