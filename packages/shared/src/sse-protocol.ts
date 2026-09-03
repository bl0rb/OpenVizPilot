import type { ToolCall } from './schemas';

/**
 * SSE-Protokoll zwischen Middleware und Extension für POST /api/chat.
 *
 * - `delta`: Text-Fragmente, sofort renderbar.
 * - `tool_calls`: EINMAL pro Antwort, serverseitig vollständig akkumuliert und
 *   JSON-validiert — die Extension muss nie halbe Argumente parsen.
 * - `done`: Abschluss mit finishReason und optionaler Token-Usage.
 * - `error`: Fehler vor oder mitten im Stream (LiteLLM meldet Upstream-Fehler
 *   nach Stream-Beginn als Events, nicht als HTTP-Status).
 * - `ping`: Heartbeat, vom Client zu ignorieren.
 */
export type SSEEventName = 'delta' | 'tool_calls' | 'done' | 'error' | 'ping';

export interface DeltaEventData {
  content: string;
}

export interface ToolCallsEventData {
  toolCalls: ToolCall[];
}

export type FinishReason = 'stop' | 'tool_calls' | 'length' | 'content_filter' | 'unknown';

export interface DoneEventData {
  finishReason: FinishReason;
  usage?: {
    promptTokens: number;
    completionTokens: number;
  };
}

export interface ErrorEventData {
  message: string;
  source: 'upstream' | 'middleware';
  retryable: boolean;
}

export type ParsedSSEEvent =
  | { event: 'delta'; data: DeltaEventData }
  | { event: 'tool_calls'; data: ToolCallsEventData }
  | { event: 'done'; data: DoneEventData }
  | { event: 'error'; data: ErrorEventData };
