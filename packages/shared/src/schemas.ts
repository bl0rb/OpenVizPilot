import { z } from 'zod';
import { MAX_FOCUS_CHARS, MAX_DASHBOARD_KEY_CHARS } from './prefs';

export const MAX_MESSAGES = 200;
export const MAX_MESSAGE_CHARS = 32_000;
export const MAX_CONTEXT_CHARS = 24_000;
export const MAX_TOOL_CALLS_PER_TURN = 16;
export const MAX_TOOL_NAME_CHARS = 100;
export const MAX_TOOL_ARG_CHARS = 8_000;
export const MAX_AUTHOR_CONTEXT_CHARS = 6_000;

export const toolCallSchema = z.object({
  id: z.string().min(1).max(200),
  type: z.literal('function'),
  function: z.object({
    name: z.string().min(1).max(MAX_TOOL_NAME_CHARS),
    arguments: z.string().max(MAX_TOOL_ARG_CHARS),
  }),
});

// Bewusst KEINE system-Rolle: die System-Prompt-Hoheit liegt bei der Middleware.
// Eine system-Message im Request fällt durch die Validierung.
export const chatMessageSchema = z.discriminatedUnion('role', [
  z.object({
    role: z.literal('user'),
    content: z.string().min(1).max(MAX_MESSAGE_CHARS),
  }),
  z.object({
    role: z.literal('assistant'),
    content: z.string().max(MAX_MESSAGE_CHARS),
    tool_calls: z.array(toolCallSchema).max(MAX_TOOL_CALLS_PER_TURN).optional(),
  }),
  z.object({
    role: z.literal('tool'),
    tool_call_id: z.string().min(1).max(200),
    content: z.string().max(MAX_MESSAGE_CHARS),
  }),
]);

export const chatRequestSchema = z.object({
  model: z.string().min(1).max(200).optional(),
  context: z.string().max(MAX_CONTEXT_CHARS),
  messages: z.array(chatMessageSchema).min(1).max(MAX_MESSAGES),
  toolChoice: z.enum(['auto', 'none']).optional(),
  /**
   * Obfuskierte Nutzer-ID aus der Tableau Extensions API
   * (environment.uniqueUserId) für das optionale User-Memory.
   * Client-asserted — siehe Vertrauensmodell in docs/admin-deployment.md.
   */
  userId: z.string().min(1).max(200).optional(),
  /**
   * Vom Workbook-Autor gepflegter Freitext (Glossar/KPI-Definitionen) —
   * DATEN für den System-Prompt, keine Anweisungen.
   */
  authorContext: z.string().max(MAX_AUTHOR_CONTEXT_CHARS).optional(),
  /**
   * DATEN, Antwortfokus des Users für dieses Dashboard (siehe prefs.ts) —
   * serverseitig unter (userId, dashboardKey) gespeicherte Präferenz, fließt
   * in den System-Prompt wie authorContext, keine Anweisung an das Modell.
   */
  answerFocus: z.string().max(MAX_FOCUS_CHARS).optional(),
  /**
   * Dashboard-Name (wie bei den Präferenzen) — NUR für die anonyme
   * Nutzungsstatistik pro Dashboard; fließt nicht in den Prompt.
   */
  dashboardKey: z.string().min(1).max(MAX_DASHBOARD_KEY_CHARS).optional(),
  /**
   * true = Wiederholung desselben Turns nach einem Fehler (Extension:
   * runTurn(null)) — die Frage wird dann NICHT erneut in der
   * Nutzungsstatistik gezählt.
   */
  retry: z.boolean().optional(),
});

export type ToolCall = z.infer<typeof toolCallSchema>;
export type ChatMessage = z.infer<typeof chatMessageSchema>;
export type ChatRequest = z.infer<typeof chatRequestSchema>;
