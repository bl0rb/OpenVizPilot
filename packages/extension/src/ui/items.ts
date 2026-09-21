import type { Suggestions } from '@openvizpilot/shared';

/** UI-Modell des Chat-Verlaufs (nicht identisch mit der LLM-Historie). */
export type ChatItem =
  | { kind: 'user'; id: number; text: string }
  | {
      kind: 'assistant';
      id: number;
      text: string;
      streaming: boolean;
      /** Namen der Kennzahlen, die in dieser Antwort per lookup_metric bestätigt wurden (W1 Trust Layer, leer/undefined = kein Treffer). */
      verifiedMetrics?: string[];
    }
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
  | {
      kind: 'error';
      id: number;
      text: string;
      retryable: boolean;
      /** Gerade neu versucht (siehe App.tsx-Reducer) — blendet den Eintrag bei Erfolg/erneutem Fehler wieder aus. */
      retrying?: boolean;
    };

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

/**
 * W2 Executive Brief: Datei für den „Als Markdown herunterladen"-Button an
 * Assistant-Antworten (MessageList.tsx) — reine Funktion, damit sie ohne DOM
 * testbar ist; der eigentliche Blob-Download bleibt dort.
 */
export function buildMarkdownExport(
  item: Extract<ChatItem, { kind: 'assistant' }>,
  now: Date = new Date(),
): { filename: string; content: string } {
  const date = now.toISOString().slice(0, 10);
  return { filename: `openvizpilot-${date}.md`, content: item.text };
}
