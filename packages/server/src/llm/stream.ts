import type {
  DoneEventData,
  ErrorEventData,
  FinishReason,
  ToolCall,
} from '@openvizpilot/shared';
import { ToolCallAccumulator } from './tool-call-accumulator';

/**
 * Minimale strukturelle Sicht auf OpenAI-kompatible Stream-Chunks.
 * Bewusst nicht die SDK-Typen: LiteLLM liefert je nach Provider auch
 * untypisierte Randfälle (Fehler-Objekte als Chunk, usage-only-Chunks).
 */
export interface ChatStreamChunk {
  choices?: Array<{
    delta?: {
      content?: string | null;
      tool_calls?: Array<{
        index?: number;
        id?: string | null;
        function?: { name?: string | null; arguments?: string | null };
      }> | null;
    };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  } | null;
  error?: unknown;
}

export interface StreamHandlers {
  onDelta(content: string): void | Promise<void>;
  onToolCalls(toolCalls: ToolCall[]): void | Promise<void>;
  onDone(data: DoneEventData): void | Promise<void>;
  onError(data: ErrorEventData): void | Promise<void>;
}

function mapFinishReason(reason: string): FinishReason {
  switch (reason) {
    case 'stop':
      return 'stop';
    case 'tool_calls':
    case 'function_call':
      return 'tool_calls';
    case 'length':
      return 'length';
    case 'content_filter':
      return 'content_filter';
    default:
      return 'unknown';
  }
}

export function extractErrorMessage(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    const e = error as Record<string, unknown>;
    if (typeof e.message === 'string') return e.message;
    const nested = e.error as Record<string, unknown> | undefined;
    if (nested && typeof nested.message === 'string') return nested.message;
    try {
      return JSON.stringify(error).slice(0, 500);
    } catch {
      /* fällt durch */
    }
  }
  return 'Unbekannter Fehler vom LLM-Upstream';
}

/**
 * Reicht einen OpenAI-kompatiblen Completion-Stream an SSE-Handler durch.
 *
 * - Text-Deltas gehen sofort raus.
 * - tool_calls-Deltas werden vollständig akkumuliert und erst am Stream-Ende
 *   als EIN Event geliefert (kapselt LiteLLM-Fragmentierungs-Randfälle).
 * - LiteLLM meldet Upstream-Fehler nach Stream-Beginn als Chunks mit
 *   error-Property statt als HTTP-Status — die werden hier erkannt.
 */
export async function pipeChatStream(
  stream: AsyncIterable<ChatStreamChunk>,
  handlers: StreamHandlers,
): Promise<void> {
  const accumulator = new ToolCallAccumulator();
  let finishReason: FinishReason = 'unknown';
  let usage: DoneEventData['usage'];

  try {
    for await (const chunk of stream) {
      if (chunk && typeof chunk === 'object' && chunk.error != null) {
        await handlers.onError({
          message: extractErrorMessage(chunk.error),
          source: 'upstream',
          retryable: true,
        });
        return;
      }
      if (chunk.usage != null) {
        usage = {
          promptTokens: chunk.usage.prompt_tokens ?? 0,
          completionTokens: chunk.usage.completion_tokens ?? 0,
        };
      }
      const choice = chunk.choices?.[0];
      if (!choice) continue;
      const delta = choice.delta;
      if (delta?.content) {
        await handlers.onDelta(delta.content);
      }
      if (delta?.tool_calls) {
        accumulator.push(delta.tool_calls);
      }
      if (choice.finish_reason) {
        finishReason = mapFinishReason(choice.finish_reason);
      }
    }
  } catch (err) {
    await handlers.onError({
      message: extractErrorMessage(err),
      source: 'upstream',
      retryable: true,
    });
    return;
  }

  if (accumulator.size > 0) {
    const result = accumulator.finish();
    if (!result.ok) {
      await handlers.onError({ message: result.error, source: 'middleware', retryable: true });
      return;
    }
    await handlers.onToolCalls(result.toolCalls);
    finishReason = 'tool_calls';
  }

  await handlers.onDone({ finishReason, usage });
}
