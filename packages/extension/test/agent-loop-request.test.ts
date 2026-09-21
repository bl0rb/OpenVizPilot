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
let mixedToolsNext = false;
/**
 * true = der Stream liefert in JEDER Runde einen Tool-Call, solange
 * request.toolChoice nicht 'none' ist — simuliert ein Modell, das das
 * Rundenbudget ausschöpft (siehe Budget-Test unten). Danach (toolChoice
 * 'none', vom Loop selbst erzwungen) liefert er eine normale Textantwort.
 */
let toolLoopActive = false;
const localCall = { id: 'local-call', type: 'function', function: { name: 'get_selected_marks', arguments: '{"worksheet":"Map"}' } };
const externalCall = { id: 'external-call', type: 'function', function: { name: 'mcp__web__search', arguments: '{"query":"Berlin"}' } };
const approval = { ticket: 'signed-ticket', destination: 'https://search.example/mcp' };
const loopCall = { id: 'loop-call', type: 'function', function: { name: 'get_filters', arguments: '{}' } };

vi.mock('../src/chat/sse-client', () => ({
  // eslint-disable-next-line @typescript-eslint/require-await
  async *streamChat(backendUrl: string, request: Record<string, unknown>, _signal: AbortSignal, apiToken?: string) {
    captured.push({ backendUrl, request, apiToken });
    if (failNext) {
      failNext = false;
      yield { event: 'error', data: { message: 'kaputt', source: 'upstream', retryable: true } };
      return;
    }
    if (mixedToolsNext) {
      mixedToolsNext = false;
      yield { event: 'tool_calls', data: { toolCalls: [localCall, externalCall], external: { 'external-call': approval } } };
      yield { event: 'done', data: { finishReason: 'tool_calls' } };
      return;
    }
    if (toolLoopActive) {
      if (request.toolChoice === 'none') {
        yield { event: 'delta', data: { content: 'Fazit' } };
        yield { event: 'done', data: { finishReason: 'stop' } };
        return;
      }
      yield { event: 'tool_calls', data: { toolCalls: [loopCall] } };
      yield { event: 'done', data: { finishReason: 'tool_calls' } };
      return;
    }
    yield { event: 'delta', data: { content: 'ok' } };
    yield { event: 'done', data: { finishReason: 'stop' } };
  },
}));

const { ChatSession, TOOL_ROUNDS_BY_MODE } = await import('../src/chat/agent-loop');
const { t } = await import('@openvizpilot/shared');

describe('ChatSession request contract', () => {
  it('routes mixed Tableau and external calls with matching grants and completes every tool pair', async () => {
    captured.length = 0;
    mixedToolsNext = true;
    const session = new ChatSession();
    const executeTool = vi.fn().mockResolvedValueOnce('Selected: Berlin').mockResolvedValueOnce('External source result');
    const callbacks = { onRoundStart: vi.fn(), onAssistantDelta: vi.fn(), onAssistantFinal: vi.fn(), onSuggestions: vi.fn(), onToolRun: vi.fn(), onNotice: vi.fn(), onError: vi.fn(), onDone: vi.fn() };
    await session.runTurn('Zusatzinformationen zur Region', { backendUrl: '', dashboardKey: 'dashboard:11111111-1111-4111-8111-111111111111', getContext: async () => '# Map', executeTool }, callbacks);
    expect(executeTool).toHaveBeenNthCalledWith(1, localCall, undefined, expect.any(AbortSignal));
    expect(executeTool).toHaveBeenNthCalledWith(2, externalCall, approval, expect.any(AbortSignal));
    expect(captured).toHaveLength(2);
    expect(captured[1]!.request.messages).toEqual([
      { role: 'user', content: 'Zusatzinformationen zur Region' },
      { role: 'assistant', content: '', tool_calls: [localCall, externalCall] },
      { role: 'tool', tool_call_id: localCall.id, content: 'Selected: Berlin' },
      { role: 'tool', tool_call_id: externalCall.id, content: 'External source result' },
    ]);
    expect(JSON.stringify(captured[1]!.request)).not.toContain('signed-ticket');
    expect(callbacks.onError).not.toHaveBeenCalled();
  });

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

  it('sends the requested mode in every round (W3 Untersuchungsmodus)', async () => {
    captured.length = 0;
    const session = new ChatSession();
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
    await session.runTurn(
      'Warum ist die Marge gesunken?',
      { backendUrl: '', mode: 'investigate', getContext: async () => '# ctx', executeTool: async () => 'ok' },
      cb,
    );
    expect(captured).toHaveLength(1);
    expect(captured[0]!.request.mode).toBe('investigate');
  });

  it('omits mode when not set (server defaults to "ask")', async () => {
    captured.length = 0;
    const session = new ChatSession();
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
    await session.runTurn('Hallo', { backendUrl: '', getContext: async () => '# ctx', executeTool: async () => 'ok' }, cb);
    expect(captured[0]!.request.mode).toBeUndefined();
  });

  it('uses the mode-specific tool-round budget and notice text (ask: 5, investigate: 12)', async () => {
    toolLoopActive = true;
    try {
      captured.length = 0;
      const askSession = new ChatSession();
      const executeTool = vi.fn().mockResolvedValue('ok');
      const askCb = {
        onRoundStart: vi.fn(),
        onAssistantDelta: vi.fn(),
        onAssistantFinal: vi.fn(),
        onSuggestions: vi.fn(),
        onToolRun: vi.fn(),
        onNotice: vi.fn(),
        onError: vi.fn(),
        onDone: vi.fn(),
      };
      await askSession.runTurn('Warum?', { backendUrl: '', getContext: async () => '# ctx', executeTool }, askCb);
      // TOOL_ROUNDS_BY_MODE.ask Tool-Runden + eine abschließende Textrunde (toolChoice 'none').
      expect(captured).toHaveLength(TOOL_ROUNDS_BY_MODE.ask + 1);
      expect(askCb.onNotice).toHaveBeenCalledWith(t('app.chat.toolBudgetReached'));
      expect(askCb.onDone).toHaveBeenCalledWith({ finishReason: 'stop' });

      captured.length = 0;
      const investigateSession = new ChatSession();
      const investigateCb = {
        onRoundStart: vi.fn(),
        onAssistantDelta: vi.fn(),
        onAssistantFinal: vi.fn(),
        onSuggestions: vi.fn(),
        onToolRun: vi.fn(),
        onNotice: vi.fn(),
        onError: vi.fn(),
        onDone: vi.fn(),
      };
      await investigateSession.runTurn(
        'Warum?',
        { backendUrl: '', mode: 'investigate', getContext: async () => '# ctx', executeTool },
        investigateCb,
      );
      expect(captured).toHaveLength(TOOL_ROUNDS_BY_MODE.investigate + 1);
      expect(investigateCb.onNotice).toHaveBeenCalledWith(t('app.chat.toolBudgetReachedInvestigate'));

      // W7 Punkt 9: Umgebungsweite Untersuchung bekommt ein noch größeres
      // Rundenbudget (16) — bis zu 5 fremde Views serverseitig lesen und
      // aggregieren braucht mehr Schritte als eine reine Dashboard-Untersuchung.
      captured.length = 0;
      const estateSession = new ChatSession();
      const estateCb = {
        onRoundStart: vi.fn(),
        onAssistantDelta: vi.fn(),
        onAssistantFinal: vi.fn(),
        onSuggestions: vi.fn(),
        onToolRun: vi.fn(),
        onNotice: vi.fn(),
        onError: vi.fn(),
        onDone: vi.fn(),
      };
      await estateSession.runTurn(
        'Warum sinkt unser Umsatz über alle Workbooks?',
        { backendUrl: '', mode: 'investigate-estate', getContext: async () => '# ctx', executeTool },
        estateCb,
      );
      expect(TOOL_ROUNDS_BY_MODE['investigate-estate']).toBe(16);
      expect(captured).toHaveLength(TOOL_ROUNDS_BY_MODE['investigate-estate'] + 1);
      expect(estateCb.onNotice).toHaveBeenCalledWith(t('app.chat.toolBudgetReachedInvestigate'));
    } finally {
      toolLoopActive = false;
    }
  });
});
