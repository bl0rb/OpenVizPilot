import type { ChatRequest, ParsedSSEEvent } from '@openvizpilot/shared';

/**
 * POST-fähiger SSE-Client: sendet den ChatRequest und liefert die typisierten
 * Events des Middleware-Protokolls (delta | tool_calls | done | error).
 * ping-Heartbeats werden verschluckt.
 */
export async function* streamChat(
  backendUrl: string,
  request: ChatRequest,
  signal: AbortSignal,
  apiToken?: string,
): AsyncGenerator<ParsedSSEEvent> {
  const base = backendUrl.replace(/\/$/, '');
  const res = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'text/event-stream',
      ...(apiToken ? { authorization: `Bearer ${apiToken}` } : {}),
    },
    body: JSON.stringify(request),
    signal,
  });

  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) detail = `${detail}: ${body.error}`;
    } catch {
      // Body nicht lesbar — Status reicht.
    }
    throw new Error(`Middleware-Fehler (${detail})`);
  }
  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.includes('text/event-stream')) {
    // z. B. Captive Portal, SPA-Fallback-Seite oder falsche Backend-URL:
    // sonst würde eine leere "Antwort" still als vollständig gelten.
    throw new Error(
      `Middleware-Antwort ist kein Event-Stream (Content-Type: ${contentType || 'unbekannt'}) — Backend-URL prüfen.`,
    );
  }
  if (!res.body) {
    throw new Error('Middleware-Antwort ohne Body');
  }

  yield* parseSSEStream(res.body);
}

const KNOWN_EVENTS = new Set(['delta', 'tool_calls', 'done', 'error']);

/** Parst einen SSE-Bytestream in typisierte Events (exportiert für Tests). */
export async function* parseSSEStream(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<ParsedSSEEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      // CRLF normalisieren (SSE-Spec erlaubt \r\n als Zeilenende). Die
      // Normalisierung läuft über den gesamten Restpuffer, damit auch ein
      // an der Chunk-Grenze getrenntes \r|\n zusammenfindet.
      buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n/g, '\n');
      let sep: number;
      while ((sep = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const event = parseBlock(block);
        if (event) yield event;
      }
    }
    buffer = (buffer + decoder.decode()).replace(/\r\n/g, '\n');
    const tail = parseBlock(buffer);
    if (tail) yield tail;
  } finally {
    reader.releaseLock();
  }
}

function parseBlock(block: string): ParsedSSEEvent | null {
  let eventName = 'message';
  const dataLines: string[] = [];
  for (const rawLine of block.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (line.startsWith(':')) continue; // Kommentar/Heartbeat
    if (line.startsWith('event:')) {
      eventName = line.slice('event:'.length).trim();
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice('data:'.length).replace(/^ /, ''));
    }
  }
  if (dataLines.length === 0 || !KNOWN_EVENTS.has(eventName)) return null;
  try {
    return { event: eventName, data: JSON.parse(dataLines.join('\n')) } as ParsedSSEEvent;
  } catch {
    return null;
  }
}
