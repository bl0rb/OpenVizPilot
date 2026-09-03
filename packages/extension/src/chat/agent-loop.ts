import {
  MAX_MESSAGES,
  MAX_MESSAGE_CHARS,
  extractSuggestions,
  type ChatMessage,
  type DoneEventData,
  type Suggestions,
  type ToolCall,
} from '@openvizpilot/shared';
import { streamChat } from './sse-client';

export const MAX_TOOL_ROUNDS = 5;

/** Grobes Zeichen-Budget für die mitgesendete Historie (~15–20k Tokens). */
const MAX_HISTORY_CHARS = 60_000;

export interface ToolRunInfo {
  id: string;
  name: string;
  argsJson: string;
  status: 'running' | 'done';
  resultPreview?: string;
}

export interface AgentCallbacks {
  /** Neue LLM-Runde beginnt — die UI legt eine neue Assistant-Bubble an. */
  onRoundStart(): void;
  onAssistantDelta(text: string): void;
  /** Finale, um den Suggestions-Block bereinigte Antwort (ersetzt den gestreamten Text). */
  onAssistantFinal(text: string): void;
  /** Anschlussfragen/Aktions-VORSCHLÄGE — Ausführung nur nach User-Klick. */
  onSuggestions(suggestions: Suggestions): void;
  onToolRun(info: ToolRunInfo): void;
  onNotice(text: string): void;
  onError(message: string, retryable: boolean): void;
  onDone(data: DoneEventData): void;
}

export interface AgentDeps {
  /** '' = gleicher Origin (Dev-Proxy bzw. Prod-Serving durch die Middleware). */
  backendUrl: string;
  /** Optionaler Auth-Token der Middleware (API_AUTH_TOKEN). */
  apiToken?: string;
  model?: string;
  /** Obfuskierte Tableau-User-ID für das serverseitige User-Memory. */
  userId?: string;
  /** Vom Workbook-Autor gepflegtes Glossar/KPI-Definitionen (DATEN, siehe system-prompt.ts). */
  authorContext?: string;
  /** Antwortfokus des Users für dieses Dashboard (DATEN, siehe system-prompt.ts). */
  answerFocus?: string;
  /** Dashboard-Name — nur für die anonyme Nutzungsstatistik pro Dashboard. */
  dashboardKey?: string;
  getContext(): Promise<string>;
  executeTool(call: ToolCall): Promise<string>;
}

/**
 * Extension-getriebener Agenten-Loop (statuslose Middleware):
 * pro Runde ein /api/chat-Call; liefert die Runde tool_calls, führt die
 * Extension sie aus und ruft mit den Ergebnissen erneut auf.
 *
 * Invarianten (Review-gehärtet):
 * - Jede assistant-Message mit tool_calls bekommt IMMER für jede call-id eine
 *   tool-Message — auch bei Abbruch (synthetisches Ergebnis). Sonst lehnen
 *   OpenAI-kompatible Provider die Historie dauerhaft mit 400 ab.
 * - Nach einem Abort mutiert der überholte Turn die Historie nicht mehr.
 * - Message-Inhalte werden auf die Server-Schema-Limits gekappt.
 */
export class ChatSession {
  readonly messages: ChatMessage[] = [];
  private abortController: AbortController | null = null;
  running = false;

  stop(): void {
    this.abortController?.abort();
  }

  /**
   * @param userText Neue User-Nachricht — oder null für einen Retry auf der
   *                 bestehenden Historie (nach einem Fehler).
   */
  async runTurn(userText: string | null, deps: AgentDeps, cb: AgentCallbacks): Promise<void> {
    if (this.running) {
      this.stop();
    }
    const abort = new AbortController();
    this.abortController = abort;
    this.running = true;

    try {
      const context = await deps.getContext();
      if (abort.signal.aborted) return;
      if (userText !== null) {
        this.messages.push({ role: 'user', content: userText.slice(0, MAX_MESSAGE_CHARS) });
      }

      let toolChoice: 'auto' | 'none' = 'auto';
      for (let round = 1; ; round++) {
        cb.onRoundStart();
        let assistantText = '';
        let toolCalls: ToolCall[] | null = null;
        let doneData: DoneEventData | null = null;

        try {
          const request = {
            model: deps.model,
            context,
            messages: trimHistory(this.messages),
            toolChoice,
            userId: deps.userId,
            authorContext: deps.authorContext,
            answerFocus: deps.answerFocus,
            dashboardKey: deps.dashboardKey,
            // Nur beim Retry nach Fehler (userText === null) — sonst zählte
            // die Statistik dieselbe Frage doppelt.
            ...(userText === null && round === 1 ? { retry: true } : {}),
          };
          for await (const ev of streamChat(deps.backendUrl, request, abort.signal, deps.apiToken)) {
            switch (ev.event) {
              case 'delta':
                assistantText += ev.data.content;
                cb.onAssistantDelta(ev.data.content);
                break;
              case 'tool_calls':
                toolCalls = ev.data.toolCalls;
                break;
              case 'done':
                doneData = ev.data;
                break;
              case 'error':
                // Partielle Assistant-Antwort NICHT in die Historie übernehmen —
                // ein Retry generiert sie sauber neu.
                cb.onError(ev.data.message, ev.data.retryable);
                return;
            }
          }
        } catch (err) {
          if (abort.signal.aborted) return;
          cb.onError(err instanceof Error ? err.message : String(err), true);
          return;
        }
        if (abort.signal.aborted) return;

        if (!doneData && !toolCalls) {
          // Stream endete ohne done/error (abgerissene Verbindung, kein SSE):
          // Teilantwort NICHT als vollständig committen.
          cb.onError('Die Verbindung wurde unterbrochen — es kam keine vollständige Antwort an.', true);
          return;
        }

        if (toolCalls && toolCalls.length > 0 && toolChoice !== 'none') {
          // Auch in Tool-Runden: ein etwaiger <suggestions>-Block ist Meta-
          // Inhalt und bleibt aus Historie und Anzeige draußen (Chips gibt es
          // nur am Turn-Ende).
          const { text: roundText } = extractSuggestions(assistantText);
          this.messages.push({
            role: 'assistant',
            content: roundText.slice(0, MAX_MESSAGE_CHARS),
            tool_calls: toolCalls,
          });
          cb.onAssistantFinal(roundText);
          // Sequentiell: die Extensions API erlaubt nur einen aktiven Reader.
          for (const call of toolCalls) {
            let content: string;
            if (abort.signal.aborted) {
              // Paar trotzdem vervollständigen — sonst ist die Historie invalide.
              content = 'Tool-Ausführung durch den Benutzer abgebrochen.';
            } else {
              cb.onToolRun({
                id: call.id,
                name: call.function.name,
                argsJson: call.function.arguments,
                status: 'running',
              });
              content = await deps.executeTool(call);
              cb.onToolRun({
                id: call.id,
                name: call.function.name,
                argsJson: call.function.arguments,
                status: 'done',
                resultPreview: content.slice(0, 1500),
              });
            }
            this.messages.push({ role: 'tool', tool_call_id: call.id, content });
          }
          if (abort.signal.aborted) return;
          if (round >= MAX_TOOL_ROUNDS) {
            toolChoice = 'none';
            cb.onNotice('Maximale Tool-Runden erreicht — erzwinge Textantwort.');
          }
          continue;
        }

        {
          // Suggestions-Block ist Meta-Inhalt: aus Anzeige UND Historie entfernen.
          const { text: finalText, suggestions } = extractSuggestions(assistantText);
          this.messages.push({ role: 'assistant', content: finalText.slice(0, MAX_MESSAGE_CHARS) });
          cb.onAssistantFinal(finalText);
          if (suggestions) {
            cb.onSuggestions(suggestions);
          }
          cb.onDone(doneData ?? { finishReason: 'unknown' });
        }
        return;
      }
    } catch (err) {
      // Fängt auch Rejections aus getContext()/executeTool() — nie unhandled.
      if (!abort.signal.aborted) {
        cb.onError(err instanceof Error ? err.message : String(err), true);
      }
    } finally {
      // Nur der noch aktuelle Turn darf den Session-Zustand zurücksetzen —
      // sonst schaltet ein überholter Turn den Nachfolger auf "nicht laufend".
      if (this.abortController === abort) {
        this.running = false;
        this.abortController = null;
      }
    }
  }
}

/**
 * Kürzt die Historie von vorn auf Zeichen- UND Message-Anzahl-Budget
 * (Server-Limit MAX_MESSAGES), immer an Turn-Grenzen. Der aktuelle Turn
 * (ab der letzten User-Message) wird NIE angeschnitten — lieber das
 * Zeichenbudget überschreiten als eine strukturell invalide Historie
 * (z. B. tool-Message ohne tool_calls-Vorgänger) zu erzeugen.
 */
export function trimHistory(messages: ChatMessage[]): ChatMessage[] {
  const result = [...messages];

  const msgSize = (m: ChatMessage): number => {
    let n = m.content.length + 50;
    if (m.role === 'assistant' && m.tool_calls) {
      for (const t of m.tool_calls) {
        n += t.function.arguments.length + t.function.name.length + t.id.length + 20;
      }
    }
    return n;
  };
  const total = () => result.reduce((sum, m) => sum + msgSize(m), 0);
  const currentTurnStart = (): number => {
    for (let i = result.length - 1; i >= 0; i--) {
      if (result[i]?.role === 'user') return i;
    }
    return 0;
  };

  while ((total() > MAX_HISTORY_CHARS || result.length > MAX_MESSAGES) && currentTurnStart() > 0) {
    // Ältesten Turn vollständig entfernen: erste (User-)Message …
    result.shift();
    // … und alles bis zur nächsten User-Message hinterher (Turn-Grenze).
    while (result.length > 0 && result[0]?.role !== 'user') {
      result.shift();
    }
  }
  return result;
}
