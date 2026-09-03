import type { Suggestions } from '@openvizpilot/shared';

/** UI-Modell des Chat-Verlaufs (nicht identisch mit der LLM-Historie). */
export type ChatItem =
  | { kind: 'user'; id: number; text: string }
  | { kind: 'assistant'; id: number; text: string; streaming: boolean }
  | {
      kind: 'tool';
      id: number;
      callId: string;
      name: string;
      /** Menschenlesbare Kurzform der Argumente (z. B. Worksheet-Name). */
      argsSummary?: string;
      status: 'running' | 'done';
      preview?: string;
    }
  | { kind: 'suggestions'; id: number; suggestions: Suggestions }
  | { kind: 'notice'; id: number; text: string }
  | { kind: 'error'; id: number; text: string; retryable: boolean };

/** Kompakte Argument-Zusammenfassung für die Trace-Anzeige. */
export function summarizeToolArgs(argsJson: string): string | undefined {
  try {
    const args = JSON.parse(argsJson) as Record<string, unknown>;
    const parts: string[] = [];
    if (typeof args.worksheet === 'string') parts.push(`„${args.worksheet}"`);
    if (typeof args.maxRows === 'number') parts.push(`${args.maxRows} Zeilen`);
    if (Array.isArray(args.columns) && args.columns.length > 0) {
      parts.push(`${args.columns.length} Spalten`);
    }
    return parts.length > 0 ? parts.join(' · ') : undefined;
  } catch {
    return undefined;
  }
}
