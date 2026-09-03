import type { ParsedSSEEvent } from '@openvizpilot/shared';
import { describe, expect, it } from 'vitest';
import { parseSSEStream } from '../src/chat/sse-client';

function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
}

async function collect(chunks: string[]): Promise<ParsedSSEEvent[]> {
  const events: ParsedSSEEvent[] = [];
  for await (const ev of parseSSEStream(streamFromChunks(chunks))) {
    events.push(ev);
  }
  return events;
}

describe('parseSSEStream', () => {
  it('parses complete events', async () => {
    const events = await collect([
      'event: delta\ndata: {"content":"Hallo"}\n\nevent: done\ndata: {"finishReason":"stop"}\n\n',
    ]);
    expect(events).toEqual([
      { event: 'delta', data: { content: 'Hallo' } },
      { event: 'done', data: { finishReason: 'stop' } },
    ]);
  });

  it('handles events split across arbitrary chunk boundaries', async () => {
    const events = await collect([
      'event: del',
      'ta\nda',
      'ta: {"content":"a',
      'b"}\n',
      '\nevent: done\ndata: {"finishReason":"stop"}\n\n',
    ]);
    expect(events[0]).toEqual({ event: 'delta', data: { content: 'ab' } });
    expect(events[1]?.event).toBe('done');
  });

  it('ignores ping events and comments', async () => {
    const events = await collect([
      ': heartbeat\n\nevent: ping\ndata: {}\n\nevent: delta\ndata: {"content":"x"}\n\n',
    ]);
    expect(events).toHaveLength(1);
    expect(events[0]?.event).toBe('delta');
  });

  it('handles CRLF block separators (SSE spec) mid-stream', async () => {
    const events = await collect([
      'event: delta\r\ndata: {"content":"x"}\r\n\r\nevent: done\r\ndata: {"finishReason":"stop"}\r\n\r\n',
    ]);
    expect(events).toEqual([
      { event: 'delta', data: { content: 'x' } },
      { event: 'done', data: { finishReason: 'stop' } },
    ]);
  });

  it('handles a CR/LF pair split across chunk boundaries', async () => {
    const events = await collect([
      'event: delta\r\ndata: {"content":"x"}\r\n\r',
      '\nevent: done\r\ndata: {"finishReason":"stop"}\r\n\r\n',
    ]);
    expect(events).toHaveLength(2);
    expect(events[1]?.event).toBe('done');
  });

  it('skips malformed JSON blocks instead of crashing', async () => {
    const events = await collect([
      'event: delta\ndata: {broken\n\nevent: delta\ndata: {"content":"ok"}\n\n',
    ]);
    expect(events).toHaveLength(1);
    expect((events[0]?.data as { content: string }).content).toBe('ok');
  });

  it('parses a trailing block without final separator', async () => {
    const events = await collect(['event: done\ndata: {"finishReason":"stop"}']);
    expect(events).toHaveLength(1);
  });
});
