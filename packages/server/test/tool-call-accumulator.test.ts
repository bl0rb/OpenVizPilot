import { describe, expect, it } from 'vitest';
import { ToolCallAccumulator } from '../src/llm/tool-call-accumulator';

describe('ToolCallAccumulator', () => {
  it('accumulates a single call with fragmented arguments', () => {
    const acc = new ToolCallAccumulator();
    acc.push([{ index: 0, id: 'call_abc', function: { name: 'get_filters', arguments: '' } }]);
    acc.push([{ index: 0, function: { arguments: '{"work' } }]);
    acc.push([{ index: 0, function: { arguments: 'sheet":"Umsatz"}' } }]);
    const result = acc.finish();
    expect(result).toEqual({
      ok: true,
      toolCalls: [
        {
          id: 'call_abc',
          type: 'function',
          function: { name: 'get_filters', arguments: '{"worksheet":"Umsatz"}' },
        },
      ],
    });
  });

  it('handles parallel calls with interleaved deltas', () => {
    const acc = new ToolCallAccumulator();
    acc.push([{ index: 0, id: 'a', function: { name: 'get_parameters', arguments: '' } }]);
    acc.push([{ index: 1, id: 'b', function: { name: 'list_worksheets', arguments: '' } }]);
    acc.push([{ index: 0, function: { arguments: '{}' } }]);
    acc.push([{ index: 1, function: { arguments: '{}' } }]);
    const result = acc.finish();
    if (!result.ok) throw new Error(result.error);
    expect(result.toolCalls.map((t) => t.function.name)).toEqual(['get_parameters', 'list_worksheets']);
    expect(result.toolCalls.map((t) => t.id)).toEqual(['a', 'b']);
  });

  it('attributes deltas without index to the last seen call', () => {
    const acc = new ToolCallAccumulator();
    acc.push([{ index: 0, id: 'x', function: { name: 'get_filters', arguments: '{"a"' } }]);
    acc.push([{ function: { arguments: ':1}' } }]);
    const result = acc.finish();
    if (!result.ok) throw new Error(result.error);
    expect(result.toolCalls[0]?.function.arguments).toBe('{"a":1}');
  });

  it('generates a fallback id when none was streamed', () => {
    const acc = new ToolCallAccumulator();
    acc.push([{ index: 0, function: { name: 'get_parameters', arguments: '{}' } }]);
    const result = acc.finish();
    if (!result.ok) throw new Error(result.error);
    expect(result.toolCalls[0]?.id).toBe('call_0');
  });

  it('treats empty arguments as {}', () => {
    const acc = new ToolCallAccumulator();
    acc.push([{ index: 0, id: 'x', function: { name: 'list_worksheets' } }]);
    const result = acc.finish();
    if (!result.ok) throw new Error(result.error);
    expect(result.toolCalls[0]?.function.arguments).toBe('{}');
  });

  it('accumulates a fragmented function name', () => {
    const acc = new ToolCallAccumulator();
    acc.push([{ index: 0, id: 'x', function: { name: 'get_' } }]);
    acc.push([{ index: 0, function: { name: 'filters', arguments: '{}' } }]);
    const result = acc.finish();
    if (!result.ok) throw new Error(result.error);
    expect(result.toolCalls[0]?.function.name).toBe('get_filters');
  });

  it('reports invalid JSON arguments instead of emitting a broken call', () => {
    const acc = new ToolCallAccumulator();
    acc.push([{ index: 0, id: 'x', function: { name: 'get_filters', arguments: '{"unterminated' } }]);
    const result = acc.finish();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('get_filters');
  });

  it('reports a call that never received a name', () => {
    const acc = new ToolCallAccumulator();
    acc.push([{ index: 0, id: 'x', function: { arguments: '{}' } }]);
    const result = acc.finish();
    expect(result.ok).toBe(false);
  });

  it('is empty when no deltas were pushed', () => {
    const acc = new ToolCallAccumulator();
    expect(acc.size).toBe(0);
    expect(acc.finish()).toEqual({ ok: true, toolCalls: [] });
  });

  it('rejects more tool calls than the request schema allows (16)', () => {
    const acc = new ToolCallAccumulator();
    for (let i = 0; i < 17; i++) {
      acc.push([{ index: i, id: `c${i}`, function: { name: 'get_parameters', arguments: '{}' } }]);
    }
    const result = acc.finish();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('Zu viele');
  });

  it('rejects arguments longer than the request schema allows (8000)', () => {
    const acc = new ToolCallAccumulator();
    const hugeArgs = JSON.stringify({ worksheet: 'x'.repeat(9_000) });
    acc.push([{ index: 0, id: 'c0', function: { name: 'get_filters', arguments: hugeArgs } }]);
    const result = acc.finish();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('zu lang');
  });
});
