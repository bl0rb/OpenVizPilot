import { zValidator } from '@hono/zod-validator';
import { extractSuggestions, MAX_MESSAGE_CHARS, MAX_MESSAGES, type ModelOption, type ToolCall } from '@openvizpilot/shared';
import { buildDesktopAgent, DATASOURCE_CONSENT_TEXT, SERVER_DATA_CONSENT_TEXT, type AuthVariables, type EeFeature, type TableauService } from '@openvizpilot/ee/server';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import OpenAI from 'openai';
import { z } from 'zod';
import type { AppConfig } from '../env';
import { pipeChatStream } from '../llm/stream';
import type { Logger } from '../logger';
import type { MemoryStore } from '../memory/store';
import { classifyUpstreamError, CONTINUE_AFTER_LENGTH_PROMPT, MAX_CONTINUATIONS, resolveModel } from './chat';

const HEARTBEAT_MS = 15_000;
/** Nur die Vorschau der Tool-Ergebnisse geht an die App — das volle Ergebnis bleibt im Loop. */
const TOOL_PREVIEW_CHARS = 1_500;

/**
 * `/api/desktop` — Schnittstelle der Desktop-App (clients/desktop, Enterprise):
 *
 * - GET  /session  Wer ist angemeldet, welche Freigaben gelten, ist der Agent verfügbar,
 *                  welche Einwilligungen liegen vor (plus Texte für die Einwilligungskarte).
 * - POST /chat     Ein Turn mit SERVERSEITIGEM Agenten-Loop: Die App sendet nur Nutzer- und
 *                  Assistenten-Text; Tool-Aufrufe laufen hier gegen den TableauService (ee/)
 *                  und erscheinen als `tool`-Events. Events: delta | tool | consent_required |
 *                  notice | final | done | error | ping.
 *
 * Der Dashboard-Chat (/api/chat, extension-getriebener Loop) bleibt davon unberührt.
 */

/** Grobes Zeichen-Budget für die mitgesendete Historie (~15–20k Tokens) — wie trimHistory der Extension. */
export const DESKTOP_MAX_HISTORY_CHARS = 60_000;

export const desktopChatRequestSchema = z.object({
  model: z.string().min(1).max(200).optional(),
  mode: z.enum(['ask', 'investigate']).optional(),
  /** true = Wiederholung desselben Turns nach einem Fehler — zählt nicht erneut in der Nutzungsstatistik. */
  retry: z.boolean().optional(),
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().min(1).max(MAX_MESSAGE_CHARS),
  })).min(1).max(MAX_MESSAGES),
});

export type DesktopChatRequest = z.infer<typeof desktopChatRequestSchema>;

/**
 * Kürzt die Historie von vorn auf das Zeichen-Budget, immer an Turn-Grenzen (ab einer
 * user-Nachricht); der aktuelle Turn (ab der letzten user-Nachricht) bleibt immer erhalten.
 */
export function trimDesktopHistory(messages: DesktopChatRequest['messages'], maxChars = DESKTOP_MAX_HISTORY_CHARS): DesktopChatRequest['messages'] {
  const result = [...messages];
  const total = () => result.reduce((sum, m) => sum + m.content.length + 50, 0);
  const currentTurnStart = () => {
    for (let i = result.length - 1; i >= 0; i -= 1) if (result[i]?.role === 'user') return i;
    return 0;
  };
  while (total() > maxChars && currentTurnStart() > 0) {
    result.shift();
    while (result.length > 0 && result[0]?.role !== 'user') result.shift();
  }
  return result;
}

const DENIED: Record<'oidc_required' | 'approval_required' | 'tableau_unavailable', { status: 402 | 403 | 503; error: string }> = {
  oidc_required: { status: 403, error: 'Persönliche Anmeldung per Single Sign-On erforderlich.' },
  approval_required: { status: 403, error: 'Tableau-API ist für dein Konto noch nicht freigegeben — bitte den Admin (Benutzer & Zugriff).' },
  tableau_unavailable: { status: 503, error: 'Tableau-Integration nicht verfügbar — Enterprise-Lizenz (tableauServer, sso) und eine aktive Tableau-Konfiguration mit genau einer Site erforderlich.' },
};

export function createDesktopRoute(
  config: AppConfig,
  logger: Logger,
  client: OpenAI,
  memoryStore: MemoryStore | null,
  hasEeFeature: (feature: EeFeature) => Promise<boolean>,
  tableau: TableauService | null,
): Hono<AuthVariables> {
  const app = new Hono<AuthVariables>();
  const metricCatalog = async () => (memoryStore ? memoryStore.getMetricCatalog() : null);

  app.get('/session', async (c) => {
    const access = c.get('userAccess');
    const user = c.get('oidcUser');
    const agent = await buildDesktopAgent({ user, access, tableau, hasFeature: hasEeFeature, mode: 'ask', metricCatalog: async () => null });
    const consent: { serverData: string | null; datasource: string | null } = { serverData: null, datasource: null };
    if (access?.serverData && access.id && access.consent) {
      try {
        const [serverDataAt, datasourceAt] = await Promise.all([
          access.consent.get(access.id),
          tableau?.audit?.getDatasourceConsent ? tableau.audit.getDatasourceConsent(access.id) : Promise.resolve(null),
        ]);
        consent.serverData = serverDataAt?.toISOString() ?? null;
        consent.datasource = datasourceAt && serverDataAt && datasourceAt.getTime() >= serverDataAt.getTime() ? datasourceAt.toISOString() : null;
      } catch {
        /* Einwilligung nicht lesbar — die App zeigt die Karte beim ersten Tool-Aufruf erneut */
      }
    }
    c.header('cache-control', 'no-store');
    return c.json({
      user: { name: user?.name ?? null, email: user?.email ?? null },
      access: { ai: Boolean(access?.ai), tableauApi: Boolean(access?.tableauApi), serverData: Boolean(access?.serverData) },
      agent: 'reason' in agent ? { available: false, reason: agent.reason, error: DENIED[agent.reason].error } : { available: true, serverData: agent.serverData },
      consent: { ...consent, texts: { views: SERVER_DATA_CONSENT_TEXT, datasource: DATASOURCE_CONSENT_TEXT } },
    });
  });

  app.post(
    '/chat',
    zValidator('json', desktopChatRequestSchema, (result, c) => {
      if (!result.success) return c.json({ error: 'Ungültiger Request', details: result.error.issues }, 400);
      return undefined;
    }),
    async (c) => {
      const req = c.req.valid('json');
      const mode = req.mode ?? 'ask';
      const agent = await buildDesktopAgent({
        user: c.get('oidcUser'), access: c.get('userAccess'), tableau, hasFeature: hasEeFeature, mode, metricCatalog,
      });
      if ('reason' in agent) {
        const denied = DENIED[agent.reason];
        return c.json({ error: denied.error, code: agent.reason }, denied.status);
      }

      // Modellwahl wie im Dashboard-Chat (Admin-Katalog, Fail-Closed bei DB-Fehler).
      let catalog: ModelOption[] | null = null;
      let catalogFailed = false;
      if (memoryStore) {
        try {
          catalog = await memoryStore.getModelCatalog();
        } catch (err) {
          catalogFailed = true;
          logger.warn('model catalog read failed — restricting to allowlist/default', { name: err instanceof Error ? err.name : 'unknown' });
        }
      }
      const resolved = resolveModel({ defaultModel: config.defaultModel, envAllowlist: config.modelAllowlist, catalog, catalogFailed, requested: req.model });
      if (!resolved.ok) return c.json({ error: `Modell nicht erlaubt: ${req.model}` }, 400);
      const model = resolved.model;
      const record = (events: Array<{ metric: string; key: string; count?: number }>) => {
        if (memoryStore) memoryStore.recordUsage(events).catch(() => undefined);
      };
      // Nur frische Fragen zählen — ein Retry desselben Turns nach einem Fehler nicht (wie im Dashboard-Chat).
      if (req.retry !== true) record([{ metric: 'chat_turn', key: model }, { metric: 'desktop_turn', key: mode }]);

      return streamSSE(c, async (stream) => {
        const heartbeat = setInterval(() => {
          void stream.writeSSE({ event: 'ping', data: '{}' }).catch(() => undefined);
        }, HEARTBEAT_MS);
        const started = Date.now();
        const abortSignal = c.req.raw.signal;
        const send = (event: string, data: unknown) => stream.writeSSE({ event, data: JSON.stringify(data) });

        try {
          let messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
            { role: 'system', content: agent.systemPrompt },
            ...trimDesktopHistory(req.messages),
          ];
          let toolChoice: 'auto' | 'none' = 'auto';
          let answerText = '';
          let continuations = 0;
          for (let round = 1; ; round += 1) {
            const segmentStarted = Date.now();
            let segmentText = '';
            let toolCalls: ToolCall[] | null = null;
            let finishReason = 'unknown';
            let failed = false;
            const completion = await client.chat.completions.create(
              { model, messages, stream: true, stream_options: { include_usage: true }, tools: agent.tools, tool_choice: toolChoice },
              { signal: abortSignal },
            );
            await pipeChatStream(completion, {
              onDelta: (content) => {
                segmentText += content;
                return send('delta', { content });
              },
              onToolCalls: (calls) => {
                toolCalls = calls;
                record(calls.map((call) => ({ metric: 'tool_call', key: call.function.name })));
              },
              onDone: (data) => {
                finishReason = data.finishReason;
                logger.info('desktop chat round', { model, mode, round, finishReason: data.finishReason, durationMs: Date.now() - started });
                record([
                  { metric: 'llm_call', key: model },
                  { metric: 'llm_ms', key: model, count: Date.now() - segmentStarted },
                  { metric: 'llm_tokens_in', key: model, count: data.usage?.promptTokens ?? 0 },
                  { metric: 'llm_tokens_out', key: model, count: data.usage?.completionTokens ?? 0 },
                ]);
              },
              onError: async (data) => {
                failed = true;
                logger.warn('desktop chat stream error', { model, source: data.source });
                record([{ metric: 'chat_error', key: data.source }]);
                await send('error', data.source === 'upstream' ? { ...data, message: classifyUpstreamError(undefined, data.message) } : data);
              },
            });
            if (failed || abortSignal.aborted) return;

            const calls: ToolCall[] = toolCalls ?? [];
            if (calls.length > 0 && toolChoice !== 'none') {
              // Ein <suggestions>-Block in einer Tool-Runde ist Meta-Inhalt und bleibt aus der Historie draußen.
              const { text: roundText } = extractSuggestions(segmentText);
              messages = [...messages, { role: 'assistant', content: roundText, tool_calls: calls }];
              for (const call of calls) {
                let content: string;
                if (abortSignal.aborted) {
                  content = 'Tool-Ausführung durch den Benutzer abgebrochen.';
                } else {
                  await send('tool', { id: call.id, name: call.function.name, arguments: call.function.arguments, status: 'running' });
                  content = await agent.execute(call, {
                    signal: abortSignal,
                    onConsentRequired: (scope, text) => { void send('consent_required', { scope, text }); },
                  });
                  await send('tool', { id: call.id, name: call.function.name, arguments: call.function.arguments, status: 'done', preview: content.slice(0, TOOL_PREVIEW_CHARS) });
                }
                messages = [...messages, { role: 'tool', tool_call_id: call.id, content }];
              }
              if (abortSignal.aborted) return;
              if (round >= agent.maxRounds) {
                toolChoice = 'none';
                await send('notice', { text: 'Rundenbudget erreicht — die Antwort fasst den bisherigen Stand zusammen.' });
              }
              continue;
            }

            answerText += segmentText;
            // Am Ausgabelimit abgeschnitten: nahtlos fortsetzen wie im Dashboard-Chat (ohne neue Tool-Aufrufe).
            if (finishReason === 'length' && segmentText && continuations < MAX_CONTINUATIONS) {
              continuations += 1;
              toolChoice = 'none';
              messages = [...messages, { role: 'assistant', content: segmentText }, { role: 'user', content: CONTINUE_AFTER_LENGTH_PROMPT }];
              continue;
            }
            const { text, suggestions } = extractSuggestions(answerText);
            await send('final', { content: text, followups: suggestions?.followups ?? [] });
            await send('done', { finishReason });
            return;
          }
        } catch (err) {
          if (abortSignal.aborted) return;
          let message: string;
          let retryable = true;
          if (err instanceof OpenAI.APIError) {
            message = classifyUpstreamError(err.status, err.message);
            retryable = err.status === undefined || err.status >= 500 || err.status === 429;
            logger.error('desktop chat upstream request failed', { model, status: err.status, name: err.name });
          } else {
            message = classifyUpstreamError(undefined, err instanceof Error ? err.message : '');
            logger.error('desktop chat request failed', { model, name: err instanceof Error ? err.name : 'unknown' });
          }
          await send('error', { message, source: 'upstream', retryable }).catch(() => undefined);
        } finally {
          clearInterval(heartbeat);
        }
      });
    },
  );

  return app;
}
