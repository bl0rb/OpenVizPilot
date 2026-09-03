import { MAX_MESSAGES, type ChatMessage } from '@openvizpilot/shared';
import { describe, expect, it } from 'vitest';
import { trimHistory } from '../src/chat/agent-loop';

function turn(i: number, contentSize: number): ChatMessage[] {
  return [
    { role: 'user', content: `Frage ${i} ${'x'.repeat(contentSize)}` },
    {
      role: 'assistant',
      content: '',
      tool_calls: [{ id: `c${i}`, type: 'function', function: { name: 'get_filters', arguments: '{}' } }],
    },
    { role: 'tool', tool_call_id: `c${i}`, content: 'y'.repeat(contentSize) },
    { role: 'assistant', content: `Antwort ${i}` },
  ];
}

describe('trimHistory', () => {
  it('keeps short histories untouched', () => {
    const messages = turn(1, 100);
    expect(trimHistory(messages)).toEqual(messages);
  });

  it('drops oldest turns first and never splits tool pairs', () => {
    const messages = [...turn(1, 20_000), ...turn(2, 20_000), ...turn(3, 100)];
    const trimmed = trimHistory(messages);
    expect(trimmed.length).toBeLessThan(messages.length);
    // Turn 3 bleibt vollständig erhalten
    expect(trimmed.some((m) => m.role === 'user' && m.content.startsWith('Frage 3'))).toBe(true);
    // Keine tool-Message ohne zugehörige assistant/tool_calls-Message davor:
    for (let i = 0; i < trimmed.length; i++) {
      const m = trimmed[i];
      if (m?.role === 'tool') {
        const prev = trimmed
          .slice(0, i)
          .reverse()
          .find((p) => p.role === 'assistant' && p.tool_calls);
        expect(prev, `tool-Message an Position ${i} ohne tool_calls-Vorgänger`).toBeDefined();
      }
    }
    // Beginnt mit einer User-Message (saubere Turn-Grenze):
    expect(trimmed[0]?.role).toBe('user');
  });

  it('never trims the current turn, even if it alone exceeds the budget', () => {
    // Ein einzelner Turn mit riesigen Tool-Results darf NICHT zu einer
    // strukturell invaliden Historie (z. B. nackte tool-Message) degenerieren.
    const messages: ChatMessage[] = [
      { role: 'user', content: 'Analysiere alles' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          { id: 'c1', type: 'function', function: { name: 'get_worksheet_summary_data', arguments: '{}' } },
          { id: 'c2', type: 'function', function: { name: 'get_worksheet_summary_data', arguments: '{}' } },
          { id: 'c3', type: 'function', function: { name: 'get_worksheet_summary_data', arguments: '{}' } },
          { id: 'c4', type: 'function', function: { name: 'get_worksheet_summary_data', arguments: '{}' } },
        ],
      },
      { role: 'tool', tool_call_id: 'c1', content: 'x'.repeat(18_000) },
      { role: 'tool', tool_call_id: 'c2', content: 'x'.repeat(18_000) },
      { role: 'tool', tool_call_id: 'c3', content: 'x'.repeat(18_000) },
      { role: 'tool', tool_call_id: 'c4', content: 'x'.repeat(18_000) },
    ];
    expect(trimHistory(messages)).toEqual(messages);
  });

  it('drops an older turn when a newer over-budget turn exists', () => {
    const messages: ChatMessage[] = [
      ...turn(1, 100),
      { role: 'user', content: 'Neue Frage' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [{ id: 'z1', type: 'function', function: { name: 'get_filters', arguments: '{}' } }],
      },
      { role: 'tool', tool_call_id: 'z1', content: 'x'.repeat(70_000) },
    ];
    const trimmed = trimHistory(messages);
    expect(trimmed[0]?.role).toBe('user');
    expect(trimmed[0]?.content).toBe('Neue Frage');
    expect(trimmed).toHaveLength(3);
  });

  it('enforces the server message-count limit (MAX_MESSAGES) at turn boundaries', () => {
    const messages: ChatMessage[] = [];
    for (let i = 0; i < 150; i++) {
      messages.push({ role: 'user', content: `F${i}` }, { role: 'assistant', content: `A${i}` });
    }
    const trimmed = trimHistory(messages);
    expect(trimmed.length).toBeLessThanOrEqual(MAX_MESSAGES);
    expect(trimmed[0]?.role).toBe('user');
    // Der jüngste Turn bleibt erhalten:
    expect(trimmed[trimmed.length - 1]?.content).toBe('A149');
  });
});
