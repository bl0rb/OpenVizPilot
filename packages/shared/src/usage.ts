import { z } from 'zod';

/**
 * Anonyme Nutzungsstatistik: die Extension meldet ausschließlich Metrik+Key
 * (z. B. metric "slash_command", key "vergleich") — NIE Frage-/Antwort-
 * Inhalte und KEINE User-ID (siehe server/routes/stats.ts, server/memory/
 * store.ts). Der Server aggregiert pro Tag zu reinen Zählern.
 *
 * Die Metrik-Whitelist gilt für den ÖFFENTLICHEN /api/stats-Endpunkt (von
 * der Extension gemeldete Events). Serverseitig selbst erzeugte Zähler
 * (chat_turn, tool_call, chat_error in routes/chat.ts) laufen direkt über
 * den Store und unterliegen dieser Whitelist nicht.
 */

export const MAX_USAGE_EVENTS_PER_REQUEST = 10;
export const MAX_USAGE_KEY_CHARS = 64;

export const USAGE_METRICS = ['slash_command', 'action_executed', 'standard_question_saved'] as const;
export type UsageMetric = (typeof USAGE_METRICS)[number];

export const usageEventSchema = z.object({
  metric: z.enum(USAGE_METRICS),
  key: z.string().min(1).max(MAX_USAGE_KEY_CHARS),
});

export const usageEventsRequestSchema = z.object({
  events: z.array(usageEventSchema).max(MAX_USAGE_EVENTS_PER_REQUEST),
});

export type UsageEvent = z.infer<typeof usageEventSchema>;
