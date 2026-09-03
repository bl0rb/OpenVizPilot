import {
  MAX_TOOL_ARG_CHARS,
  MAX_TOOL_CALLS_PER_TURN,
  MAX_TOOL_NAME_CHARS,
  type ToolCall,
} from '@openvizpilot/shared';

/**
 * Akkumuliert fragmentierte tool_calls-Deltas eines OpenAI-kompatiblen Streams
 * zu vollständigen, JSON-validierten Tool-Calls.
 *
 * Kapselt die bekannten LiteLLM-Streaming-Randfälle (fragmentierte arguments,
 * fehlende index/id in Folge-Deltas) an genau einer Stelle — die Extension
 * bekommt nur fertige Tool-Calls zu sehen.
 */
export interface DeltaToolCall {
  index?: number;
  id?: string | null;
  type?: string;
  function?: {
    name?: string | null;
    arguments?: string | null;
  };
}

interface Entry {
  id?: string;
  name: string;
  arguments: string;
}

export type AccumulatorResult =
  | { ok: true; toolCalls: ToolCall[] }
  | { ok: false; error: string };

export class ToolCallAccumulator {
  private byIndex = new Map<number, Entry>();
  private lastIndex: number | null = null;

  push(deltas: DeltaToolCall[] | null | undefined): void {
    if (!deltas) return;
    for (const d of deltas) {
      // Folge-Deltas mancher Provider lassen index weg → gehört zum letzten Call.
      const index = typeof d.index === 'number' ? d.index : (this.lastIndex ?? 0);
      this.lastIndex = index;

      let entry = this.byIndex.get(index);
      if (!entry) {
        entry = { name: '', arguments: '' };
        this.byIndex.set(index, entry);
      }
      if (d.id) {
        entry.id = d.id;
      }
      if (d.function?.name) {
        entry.name += d.function.name;
      }
      if (typeof d.function?.arguments === 'string') {
        entry.arguments += d.function.arguments;
      }
    }
  }

  get size(): number {
    return this.byIndex.size;
  }

  finish(): AccumulatorResult {
    // Die Limits des Request-Schemas (shared/schemas.ts) hier an der
    // Emissionsstelle durchsetzen — sonst emittiert der Server tool_calls,
    // die er in der Folgerunde selbst mit 400 ablehnt (Session-Sackgasse).
    if (this.byIndex.size > MAX_TOOL_CALLS_PER_TURN) {
      return {
        ok: false,
        error: `Zu viele parallele Tool-Calls (${this.byIndex.size}, Maximum ${MAX_TOOL_CALLS_PER_TURN})`,
      };
    }
    const toolCalls: ToolCall[] = [];
    const indices = [...this.byIndex.keys()].sort((a, b) => a - b);
    for (const index of indices) {
      const entry = this.byIndex.get(index);
      if (!entry) continue;
      if (!entry.name) {
        return { ok: false, error: `Unvollständiger Tool-Call (Index ${index}): kein Funktionsname empfangen` };
      }
      if (entry.name.length > MAX_TOOL_NAME_CHARS) {
        return { ok: false, error: `Tool-Call mit überlangem Funktionsnamen (${entry.name.length} Zeichen)` };
      }
      const args = entry.arguments.trim() === '' ? '{}' : entry.arguments;
      if (args.length > MAX_TOOL_ARG_CHARS) {
        return {
          ok: false,
          error: `Tool-Call "${entry.name}": Argumente zu lang (${args.length} Zeichen, Maximum ${MAX_TOOL_ARG_CHARS})`,
        };
      }
      try {
        JSON.parse(args);
      } catch {
        return {
          ok: false,
          error: `Tool-Call "${entry.name}": Argumente sind kein gültiges JSON`,
        };
      }
      toolCalls.push({
        id: entry.id ?? `call_${index}`,
        type: 'function',
        function: { name: entry.name, arguments: args },
      });
    }
    return { ok: true, toolCalls };
  }
}
