import { chatRequestSchema, DEFAULT_SLASH_COMMANDS, t, type ParsedSSEEvent } from '@openvizpilot/shared';
import { respond, type RespondOptions } from './responder';

/**
 * Lokales „Backend" für den statischen Demo-Modus: beantwortet alle
 * /api/*-Aufrufe der Extension im Browser, damit sie ohne Middleware läuft.
 * Installiert sich als fetch-Wrapper (installDemoBackend) — die Client-Module
 * (sse-client, auth-session, commands-client, …) bleiben unverändert.
 */

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function sseResponse(events: AsyncGenerator<ParsedSSEEvent>): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const next = await events.next();
      if (next.done) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(`event: ${next.value.event}\ndata: ${JSON.stringify(next.value.data)}\n\n`));
    },
    cancel() {
      void events.return(undefined);
    },
  });
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

export const DEMO_MODEL_ID = 'demo';

export function demoStarters(): string[] {
  return [t('demo.starter.filters'), t('demo.starter.top'), t('demo.starter.summary')];
}

export async function handleDemoRequest(
  method: string,
  pathname: string,
  body?: string | null,
  options: RespondOptions = {},
): Promise<Response> {
  const m = method.toUpperCase();
  if (m === 'GET' && pathname === '/api/auth/config') return json({ mode: 'none' });
  if (m === 'GET' && pathname === '/api/session') {
    return json({ access: { ai: true, tableauApi: false, serverData: false } });
  }
  if (m === 'GET' && pathname === '/api/features') {
    // Dashboard-Aktionen laufen rein clientseitig und gehören zum Look-and-Feel;
    // alles Serverseitige (Memory, Abfragen, Watch, Server-Daten) gibt es nicht.
    return json({ features: { sso: false, memory: false, savedQueries: false, actions: true, watch: false, serverData: false } });
  }
  if (m === 'GET' && pathname === '/api/models') {
    return json({ models: [{ id: DEMO_MODEL_ID, label: t('demo.modelLabel') }], defaultModel: DEMO_MODEL_ID });
  }
  if (m === 'GET' && pathname === '/api/commands') {
    return json({ commands: DEFAULT_SLASH_COMMANDS, starters: demoStarters() });
  }
  if (m === 'POST' && pathname === '/api/stats') return new Response(null, { status: 204 });
  if (m === 'POST' && pathname === '/api/chat') {
    let parsed: unknown;
    try {
      parsed = JSON.parse(body ?? '');
    } catch {
      return json({ error: 'invalid_json' }, 400);
    }
    const request = chatRequestSchema.safeParse(parsed);
    if (!request.success) return json({ error: 'invalid_request' }, 400);
    return sseResponse(respond(request.data, options));
  }
  return json({ error: 'not_available_in_demo' }, 404);
}

/** Leitet alle /api/*-Aufrufe (beliebiger Origin) an den lokalen Responder um. */
export function installDemoBackend(): void {
  const original = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    let url: URL;
    try {
      url = new URL(href, window.location.href);
    } catch {
      return original(input, init);
    }
    if (!url.pathname.startsWith('/api/')) return original(input, init);
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
    const body = typeof init?.body === 'string' ? init.body : input instanceof Request ? await input.text() : null;
    return handleDemoRequest(method, url.pathname, body, { signal: init?.signal ?? undefined });
  };
}
