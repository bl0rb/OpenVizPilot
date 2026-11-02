import type { ChatRequest, ParsedSSEEvent } from '@openvizpilot/shared';
import { describe, expect, it } from 'vitest';
import { parseSSEStream } from '../src/chat/sse-client';
import { handleDemoRequest } from '../src/demo/demo-backend';
import { composeAnswer, parseContext, planTool, respond } from '../src/demo/responder';

const CONTEXT = `# Dashboard: Vertrieb

## Worksheet: Umsatz nach Region
Spalten: Region (string), SUM(Umsatz) (float), CNT(Aufträge) (int)
Zeilen (aggregiert, gefiltert): 4
Aktive Filter:
- Region: Ost, West

## Worksheet: Trend (im Dashboard aktuell ausgeblendet)
Spalten: MONTH(Datum) (date), SUM(Umsatz) (float)
Zeilen (aggregiert, gefiltert): 12
Aktive Filter: keine

## Parameter
- Zielwert: 100

_Stand: 2026-01-01T00:00:00.000Z_`;

async function collect(gen: AsyncGenerator<ParsedSSEEvent>): Promise<ParsedSSEEvent[]> {
  const out: ParsedSSEEvent[] = [];
  for await (const ev of gen) out.push(ev);
  return out;
}

function request(messages: ChatRequest['messages'], toolChoice: 'auto' | 'none' = 'auto'): ChatRequest {
  return { context: CONTEXT, messages, toolChoice };
}

describe('demo responder', () => {
  it('parses the context snapshot', () => {
    const ctx = parseContext(CONTEXT);
    expect(ctx.dashboard).toBe('Vertrieb');
    expect(ctx.worksheets.map((w) => w.name)).toEqual(['Umsatz nach Region', 'Trend']);
    expect(ctx.worksheets[0]?.columns).toEqual([
      { name: 'Region', type: 'string' },
      { name: 'SUM(Umsatz)', type: 'float' },
      { name: 'CNT(Aufträge)', type: 'int' },
    ]);
    expect(ctx.worksheets[0]?.rowCount).toBe(4);
    expect(ctx.worksheets[0]?.filters).toEqual(['Region: Ost, West']);
    expect(ctx.worksheets[1]?.filters).toEqual([]);
  });

  it('plans tools from keywords', () => {
    const ctx = parseContext(CONTEXT);
    expect(planTool('Welche Filter sind aktiv?', ctx)).toEqual({ name: 'get_filters', args: {} });
    expect(planTool('Zeig mir die Top 5.', ctx)).toEqual({
      name: 'breakdown_by',
      args: { worksheet: 'Umsatz nach Region', dimension: 'Region', measure: 'SUM(Umsatz)', maxGroups: 5 },
    });
    expect(planTool('Was zeigt „Trend”?', ctx)).toEqual({
      name: 'get_worksheet_summary_data',
      args: { worksheet: 'Trend', maxRows: 10 },
    });
    expect(planTool('Fasse das Dashboard zusammen.', ctx)).toEqual({ name: 'list_worksheets', args: {} });
    expect(planTool('Erzähl mir einen Witz', ctx)).toBeNull();
  });

  it('emits a tool call for a filter question and an answer after the tool result', async () => {
    const round1 = await collect(respond(request([{ role: 'user', content: 'Welche Filter sind aktiv?' }]), { delayMs: 0 }));
    expect(round1[0]?.event).toBe('tool_calls');
    const call = round1[0]?.event === 'tool_calls' ? round1[0].data.toolCalls[0] : undefined;
    expect(call?.function.name).toBe('get_filters');
    expect(round1[1]).toEqual({ event: 'done', data: { finishReason: 'tool_calls' } });

    const round2 = await collect(
      respond(
        request([
          { role: 'user', content: 'Welche Filter sind aktiv?' },
          { role: 'assistant', content: '', tool_calls: [call!] },
          { role: 'tool', tool_call_id: call!.id, content: '**Umsatz nach Region**\n- Region: Ost, West' },
        ]),
        { delayMs: 0 },
      ),
    );
    const text = round2.filter((e) => e.event === 'delta').map((e) => (e.event === 'delta' ? e.data.content : '')).join('');
    expect(text).toContain('- Region: Ost, West');
    expect(text).toMatch(/<suggestions>\{"followups":\[/);
    expect(round2[round2.length - 1]).toEqual({ event: 'done', data: { finishReason: 'stop' } });
  });

  it('never emits tool calls when toolChoice is none', async () => {
    const events = await collect(respond(request([{ role: 'user', content: 'Welche Filter sind aktiv?' }], 'none'), { delayMs: 0 }));
    expect(events.some((e) => e.event === 'tool_calls')).toBe(false);
    expect(events[events.length - 1]?.event).toBe('done');
  });

  it('composes a breakdown answer with intro from the arguments', () => {
    const ctx = parseContext(CONTEXT);
    const text = composeAnswer(
      { id: 'x', type: 'function', function: { name: 'breakdown_by', arguments: JSON.stringify({ worksheet: 'Umsatz nach Region', dimension: 'Region', measure: 'SUM(Umsatz)' }) } },
      '| Region | sum(SUM(Umsatz)) |',
      ctx,
    );
    expect(text).toContain('SUM(Umsatz)');
    expect(text).toContain('| Region |');
  });
});

describe('demo backend', () => {
  it('answers the startup endpoints locally', async () => {
    expect(await (await handleDemoRequest('GET', '/api/auth/config')).json()).toEqual({ mode: 'none' });
    expect((await (await handleDemoRequest('GET', '/api/session')).json()).access.ai).toBe(true);
    expect((await (await handleDemoRequest('GET', '/api/models')).json()).defaultModel).toBe('demo');
    expect((await (await handleDemoRequest('GET', '/api/commands')).json()).starters).toHaveLength(3);
    expect((await handleDemoRequest('POST', '/api/stats', '{}')).status).toBe(204);
    expect((await handleDemoRequest('POST', '/api/dashboards', '{}')).status).toBe(404);
  });

  it('streams /api/chat as a middleware-compatible event stream', async () => {
    const res = await handleDemoRequest('POST', '/api/chat', JSON.stringify(request([{ role: 'user', content: 'Welche Parameter gibt es?' }])), { delayMs: 0 });
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const events = await collect(parseSSEStream(res.body!));
    expect(events[0]?.event).toBe('tool_calls');
    expect(events[0]?.event === 'tool_calls' && events[0].data.toolCalls[0]?.function.name).toBe('get_parameters');
  });

  it('rejects an invalid chat request', async () => {
    expect((await handleDemoRequest('POST', '/api/chat', '{"nope":1}')).status).toBe(400);
  });
});
