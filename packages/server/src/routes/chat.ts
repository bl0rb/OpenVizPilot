import { zValidator } from '@hono/zod-validator';
import { chatRequestSchema, toolDefinitions, type ModelOption } from '@openvizpilot/shared';
import type { AuthVariables } from '@openvizpilot/ee/server';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import OpenAI from 'openai';
import type { AppConfig } from '../env';
import { checkScope, extractLatestUserMessage, SCOPE_REFUSAL_MESSAGE } from '../llm/scope-guard';
import { pipeChatStream } from '../llm/stream';
import { pseudonymizeUser } from '../usage-pseudonym';
import type { Logger } from '../logger';
import {
  extractFactsInBackground,
  personalizationPromptSection,
  type EeFeature,
  type PersonalizationStore,
} from '@openvizpilot/ee/server';
import type { MemoryStore } from '../memory/store';
import { buildSystemPrompt } from '../system-prompt';

const HEARTBEAT_MS = 15_000;

/**
 * Upstream-Fehlertexte gehen NIE wörtlich an den Browser (CWE-209: sie können
 * interne Routing-/Deployment-Details des LiteLLM-Proxys enthalten) — der
 * Client bekommt eine klassifizierte, generische Meldung.
 */
export function classifyUpstreamError(status: number | undefined, raw: string): string {
  if (status === 401 || status === 403) {
    return 'Authentifizierung am LLM-Proxy fehlgeschlagen — Server-Konfiguration prüfen.';
  }
  if (status === 429 || /rate.?limit|quota|overloaded/i.test(raw)) {
    return 'Rate-Limit beim LLM-Provider erreicht — bitte kurz warten und erneut versuchen.';
  }
  if (/context.?window|maximum context|too many tokens/i.test(raw)) {
    return 'Anfrage zu groß für das Kontextfenster des Modells — Frage kürzen oder neu beginnen.';
  }
  if (status !== undefined && status >= 500) {
    return `LLM-Provider derzeit nicht erreichbar (Status ${status}).`;
  }
  return status !== undefined
    ? `LLM-Anfrage fehlgeschlagen (Status ${status}).`
    : 'LLM-Anfrage fehlgeschlagen — bitte erneut versuchen.';
}

/**
 * Löst das zu verwendende Modell auf — exportiert für Tests.
 *
 * Der Admin-Katalog ist maßgeblich für BEIDE Pfade: explizite Modellwahl
 * (nur Katalog-IDs erlaubt) und den Default-Pfad (schließt der Katalog das
 * konfigurierte DEFAULT_MODEL aus, gilt sein ERSTER Eintrag als effektives
 * Standard-Modell — identisch zur Anzeige in GET /api/models). Konnte der
 * Katalog nicht gelesen werden (DB-Fehler), gilt FAIL-CLOSED: erlaubt sind
 * nur Env-Allowlist bzw. das Default-Modell — nie "alles".
 */
export function resolveModel(input: {
  defaultModel: string;
  envAllowlist: string[] | null;
  catalog: ModelOption[] | null;
  catalogFailed: boolean;
  requested?: string;
}): { ok: true; model: string } | { ok: false } {
  const { defaultModel, envAllowlist, catalog, catalogFailed, requested } = input;
  if (catalog) {
    const ids = catalog.map((m) => m.id);
    if (requested) {
      return ids.includes(requested) ? { ok: true, model: requested } : { ok: false };
    }
    return { ok: true, model: ids.includes(defaultModel) ? defaultModel : ids[0]! };
  }
  if (!requested) return { ok: true, model: defaultModel };
  const allowlist = catalogFailed ? (envAllowlist ?? [defaultModel]) : envAllowlist;
  if (allowlist && !allowlist.includes(requested)) return { ok: false };
  return { ok: true, model: requested };
}

/** Effektives Default-Modell zum Katalog — gleiche Regel wie resolveModel. */
export function effectiveDefaultModel(defaultModel: string, catalog: ModelOption[] | null): string {
  if (!catalog || catalog.some((m) => m.id === defaultModel)) return defaultModel;
  return catalog[0]!.id;
}

export function createChatRoute(
  config: AppConfig,
  logger: Logger,
  client: OpenAI,
  memoryStore: MemoryStore | null,
  /** Speicher der Personalisierung (ee/) — null, wenn keine Datenbank konfiguriert ist. */
  personalizationStore: PersonalizationStore | null,
  /** Lizenzprüfung: das User-Memory ist eine Enterprise-Funktion (ee/personalization.ts). */
  hasEeFeature: (feature: EeFeature) => Promise<boolean>,
): Hono<AuthVariables> {
  const app = new Hono<AuthVariables>();

  // Salt einmal pro Prozess laden (DB-Singleton, unveränderlich); bei Fehler
  // beim nächsten Turn erneut versuchen.
  let saltPromise: Promise<string> | null = null;
  const usageSalt = (): Promise<string> => {
    if (!memoryStore) return Promise.reject(new Error('no store'));
    saltPromise ??= memoryStore.getUsageSalt().catch((err: unknown) => {
      saltPromise = null;
      throw err;
    });
    return saltPromise;
  };

  app.post(
    '/',
    zValidator('json', chatRequestSchema, (result, c) => {
      if (!result.success) {
        return c.json({ error: 'Ungültiger Request', details: result.error.issues }, 400);
      }
      return undefined;
    }),
    async (c) => {
      const parsedReq = c.req.valid('json');
      // OIDC-Modus: die vom IdP verifizierte Nutzer-ID ersetzt die
      // client-asserted Tableau-ID (Memory, Präferenzen, Statistik).
      const authUser = c.get('authUser');
      const req = authUser ? { ...parsedReq, userId: authUser } : parsedReq;

      // Modellwahl über den Admin-Katalog (Admin-UI → „Modelle") — Regeln
      // und Fail-Closed-Verhalten in resolveModel() oben.
      let catalog: ModelOption[] | null = null;
      let catalogFailed = false;
      if (memoryStore) {
        try {
          catalog = await memoryStore.getModelCatalog();
        } catch (err) {
          catalogFailed = true;
          logger.warn('model catalog read failed — restricting to allowlist/default', {
            name: err instanceof Error ? err.name : 'unknown',
          });
        }
      }
      const resolved = resolveModel({
        defaultModel: config.defaultModel,
        envAllowlist: config.modelAllowlist,
        catalog,
        catalogFailed,
        requested: req.model,
      });
      if (!resolved.ok) {
        return c.json({ error: `Modell nicht erlaubt: ${req.model}` }, 400);
      }
      const model = resolved.model;

      // Mit aktivem Scope-Guard braucht jeder Request eine Nutzerfrage in der
      // Historie — eine Historie ganz ohne user-Message ist kein legitimer
      // Chat-Verlauf (die Extension beginnt jeden Turn mit einer Frage) und
      // wäre sonst ein ungeprüfter Weg, Inhalte ans Hauptmodell zu schicken.
      const scopeQuestion = config.scopeGuardEnabled
        ? extractLatestUserMessage(req.messages)
        : null;
      if (config.scopeGuardEnabled && scopeQuestion === null) {
        return c.json({ error: 'Ungültiger Request: keine Nutzernachricht im Verlauf' }, 400);
      }

      // Anonyme Nutzungsstatistik: NUR ein aggregierter Zähler pro Modell,
      // fire-and-forget — nie Inhalte oder eine User-ID (siehe memory/store.ts).
      if (memoryStore) {
        memoryStore.recordUsage([{ metric: 'chat_turn', key: model }]).catch(() => undefined);
      }

      // Dashboard-Nutzung pro Anwender — der Anwender nur als nicht
      // umkehrbares Pseudonym (usage-pseudonym.ts), ohne User-ID '' (=
      // unbekannt). Zählt NUR frische Nutzerfragen (letzte Message = user,
      // kein Retry desselben Turns) und wird erst NACH dem Scope-Guard
      // aufgerufen — abgelehnte Off-Topic-Fragen sind keine Dashboard-Fragen.
      const recordDashboardQuestion = (): void => {
        if (!memoryStore || !req.dashboardKey || req.retry === true) return;
        if (req.messages[req.messages.length - 1]?.role !== 'user') return;
        const dashboardKey = req.dashboardKey;
        const userId = req.userId;
        void usageSalt()
          .then((salt) => memoryStore.recordDashboardUsage(dashboardKey, userId ? pseudonymizeUser(salt, userId) : ''))
          .catch(() => undefined);
      };

      return streamSSE(c, async (stream) => {
        const heartbeat = setInterval(() => {
          void stream.writeSSE({ event: 'ping', data: '{}' }).catch(() => undefined);
        }, HEARTBEAT_MS);
        const started = Date.now();
        const abortSignal = c.req.raw.signal;

        try {
          // Themen-Scope-Guard: klassifiziert die neueste Nutzerfrage bei
          // JEDEM Request — auch bei Tool-Runden-Fortsetzungen, denn die
          // Historie ist client-geliefert und eine ungeprüfte Fortsetzung
          // wäre sonst eine triviale Umgehung (siehe llm/scope-guard.ts).
          if (config.scopeGuardEnabled && scopeQuestion !== null) {
            const verdict = await checkScope({
              client,
              model: config.scopeModel,
              context: req.context,
              messages: req.messages,
              question: scopeQuestion,
              signal: abortSignal,
            });
            if (abortSignal.aborted) return;
            if (verdict === 'out_of_scope') {
              logger.info('chat blocked by scope guard', {
                model,
                durationMs: Date.now() - started,
              });
              if (memoryStore) {
                memoryStore
                  .recordUsage([{ metric: 'scope_blocked', key: config.scopeModel }])
                  .catch(() => undefined);
              }
              await stream.writeSSE({
                event: 'delta',
                data: JSON.stringify({ content: SCOPE_REFUSAL_MESSAGE }),
              });
              await stream.writeSSE({
                event: 'done',
                data: JSON.stringify({ finishReason: 'stop' }),
              });
              return;
            }
            if (verdict === 'unavailable') {
              // Fail-open: die THEMEN-SCOPE-Regel im System-Prompt bleibt
              // als zweite Verteidigungslinie bestehen.
              logger.warn('scope guard unavailable — proceeding without it', {
                model: config.scopeModel,
              });
            }
          }

          recordDashboardQuestion();

          let memoryFacts: string[] = [];
          // Ohne Lizenz mit "memory" wird nichts gelesen und später nichts
          // extrahiert — der Chat läuft unverändert, nur ohne Personalisierung.
          const memoryLicensed = personalizationStore !== null && req.userId ? await hasEeFeature('memory') : false;
          // Der Antwortfokus gehört zu den gespeicherten eigenen Abfragen und ist
          // damit ebenfalls lizenzpflichtig — die Prüfung gehört hierher und nicht
          // in die Extension, sonst genügte ein direkter API-Aufruf mit
          // "answerFocus" im Body, um die Personalisierung ohne Lizenz zu bekommen.
          const answerFocus = req.answerFocus && (await hasEeFeature('savedQueries')) ? req.answerFocus : undefined;
          if (personalizationStore && req.userId && memoryLicensed) {
            try {
              memoryFacts = await personalizationStore.listFacts(req.userId);
            } catch (err) {
              logger.warn('memory read failed', {
                name: err instanceof Error ? err.name : 'unknown',
              });
            }
          }

          const completion = await client.chat.completions.create(
            {
              model,
              messages: [
                {
                  role: 'system',
                  content: buildSystemPrompt(
                    req.context,
                    // Die Bausteine baut die Enterprise-Edition; ohne Lizenz sind
                    // beide Eingaben leer und der Abschnitt entfällt komplett.
                    personalizationPromptSection({ facts: memoryFacts, answerFocus }),
                    req.authorContext,
                  ),
                },
                ...req.messages,
              ],
              stream: true,
              stream_options: { include_usage: true },
              // Tools werden IMMER mitgesendet (auch bei toolChoice "none"):
              // die Historie kann tool-Messages enthalten, die manche Provider
              // ohne Tool-Definitionen ablehnen. "none" verbietet nur neue Calls.
              tools: toolDefinitions,
              tool_choice: req.toolChoice === 'none' ? 'none' : 'auto',
            },
            { signal: abortSignal },
          );

          await pipeChatStream(completion, {
            onDelta: (content) => stream.writeSSE({ event: 'delta', data: JSON.stringify({ content }) }),
            onToolCalls: (toolCalls) => {
              if (memoryStore) {
                memoryStore
                  .recordUsage(toolCalls.map((call) => ({ metric: 'tool_call', key: call.function.name })))
                  .catch(() => undefined);
              }
              return stream.writeSSE({ event: 'tool_calls', data: JSON.stringify({ toolCalls }) });
            },
            onDone: async (data) => {
              logger.info('chat done', {
                model,
                durationMs: Date.now() - started,
                finishReason: data.finishReason,
                promptTokens: data.usage?.promptTokens,
                completionTokens: data.usage?.completionTokens,
                messages: req.messages.length,
              });
              // Fakten-Extraktion nur am Turn-ENDE (nicht nach Tool-Runden),
              // fire-and-forget mit günstigem Modell.
              if (personalizationStore && req.userId && memoryLicensed && data.finishReason !== 'tool_calls') {
                extractFactsInBackground({
                  client,
                  model: config.memoryModel,
                  store: personalizationStore,
                  userId: req.userId,
                  messages: req.messages,
                  logger,
                });
              }
              await stream.writeSSE({ event: 'done', data: JSON.stringify(data) });
            },
            onError: async (data) => {
              logger.warn('chat stream error', {
                model,
                durationMs: Date.now() - started,
                source: data.source,
              });
              if (memoryStore) {
                memoryStore.recordUsage([{ metric: 'chat_error', key: data.source }]).catch(() => undefined);
              }
              const safe =
                data.source === 'upstream'
                  ? { ...data, message: classifyUpstreamError(undefined, data.message) }
                  : data;
              await stream.writeSSE({ event: 'error', data: JSON.stringify(safe) });
            },
          });
        } catch (err) {
          if (abortSignal.aborted) {
            logger.debug('chat aborted by client', { model, durationMs: Date.now() - started });
            return;
          }
          let message: string;
          let retryable = true;
          if (err instanceof OpenAI.APIError) {
            message = classifyUpstreamError(err.status, err.message);
            retryable = err.status === undefined || err.status >= 500 || err.status === 429;
            logger.error('chat upstream request failed', { model, status: err.status, name: err.name });
          } else {
            message = classifyUpstreamError(undefined, err instanceof Error ? err.message : '');
            logger.error('chat request failed', { model, name: err instanceof Error ? err.name : 'unknown' });
          }
          await stream
            .writeSSE({
              event: 'error',
              data: JSON.stringify({ message, source: 'upstream', retryable }),
            })
            .catch(() => undefined);
        } finally {
          clearInterval(heartbeat);
        }
      });
    },
  );

  return app;
}
