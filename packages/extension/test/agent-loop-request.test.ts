import { describe, expect, it, vi } from 'vitest';

/**
 * Vertrag zwischen Extension und Middleware: Was ChatSession.runTurn() pro
 * Runde tatsächlich an POST /api/chat schickt — insbesondere die
 * Kontextfelder (userId, authorContext, answerFocus, dashboardKey), die
 * serverseitig nur OPTIONAL verarbeitet werden und deren Fehlen sonst
 * lautlos Statistik oder Personalisierung leerlaufen ließe.
 */

const captured: Array<{ backendUrl: string; request: Record<string, unknown>; apiToken?: string }> = [];
/** true = der nächste gemockte Stream bricht mit einem retryable error ab. */
let failNext = false;

vi.mock('../src/chat/sse-client', () => ({
  // eslint-disable-next-line @typescript-eslint/require-await
  async *streamChat(backendUrl: string, request: Record<string, unknown>, _signal: AbortSignal, apiToken?: string) {
    captured.push({ backendUrl, request, apiToken });
    if (failNext) {
      failNext = false;
      yield { event: 'error', data: { message: 'kaputt', source: 'upstream', retryable: true } };
      return;
    }
    yield { event: 'delta', data: { content: 'ok' } };
    yield { event: 'done', data: { finishReason: 'stop' } };
  },
}));

const { ChatSession } = await import('../src/chat/agent-loop');

describe('ChatSession request contract', () => {
  it('sends the user turn together with all context fields', async () => {
    captured.length = 0;
    const session = new ChatSession();
    const onAssistantFinal = vi.fn();
    const onDone = vi.fn();

    await session.runTurn(
      'Wie läuft es?',
      {
        backendUrl: 'https://chat.example.com',
        apiToken: 'tok',
        model: 'claude-sonnet-5',
        userId: 'tableau-user-1',
        authorContext: 'Glossar',
        answerFocus: 'Kurzfassung',
        dashboardKey: 'Rentabilität',
        getContext: async () => '# Dashboard: Rentabilität',
        executeTool: async () => 'unused',
      },
      {
        onRoundStart: vi.fn(),
        onAssistantDelta: vi.fn(),
        onAssistantFinal,
        onSuggestions: vi.fn(),
        onToolRun: vi.fn(),
        onNotice: vi.fn(),
        onError: vi.fn(),
        onDone,
      },
    );

    expect(captured).toHaveLength(1);
    const { backendUrl, request, apiToken } = captured[0]!;
    expect(backendUrl).toBe('https://chat.example.com');
    expect(apiToken).toBe('tok');
    expect(request).toMatchObject({
      model: 'claude-sonnet-5',
      context: '# Dashboard: Rentabilität',
      toolChoice: 'auto',
      userId: 'tableau-user-1',
      authorContext: 'Glossar',
      answerFocus: 'Kurzfassung',
      dashboardKey: 'Rentabilität',
    });
    expect(request.messages).toEqual([{ role: 'user', content: 'Wie läuft es?' }]);
    expect(request.retry).toBeUndefined();
    expect(onAssistantFinal).toHaveBeenCalledWith('ok');
    expect(onDone).toHaveBeenCalledWith({ finishReason: 'stop' });
  });

  it('marks a retry of the same turn so the server does not count the question twice', async () => {
    captured.length = 0;
    const session = new ChatSession();
    const deps = {
      backendUrl: '',
      dashboardKey: 'Rentabilität',
      getContext: async () => '# ctx',
      executeTool: async () => 'unused',
    };
    const cb = {
      onRoundStart: vi.fn(),
      onAssistantDelta: vi.fn(),
      onAssistantFinal: vi.fn(),
      onSuggestions: vi.fn(),
      onToolRun: vi.fn(),
      onNotice: vi.fn(),
      onError: vi.fn(),
      onDone: vi.fn(),
    };
    failNext = true;
    await session.runTurn('Frage', deps, cb); // Stream bricht ab → Fehlerbanner mit Retry
    expect(cb.onError).toHaveBeenCalledWith('kaputt', true);
    await session.runTurn(null, deps, cb); // Retry auf bestehender Historie
    expect(captured).toHaveLength(2);
    expect(captured[0]!.request.retry).toBeUndefined();
    expect(captured[1]!.request.retry).toBe(true);
    expect(captured[1]!.request.messages).toEqual(captured[0]!.request.messages);
  });
});
