import { zValidator } from '@hono/zod-validator';
import { usageEventsRequestSchema } from '@openvizpilot/shared';
import { Hono } from 'hono';
import type { Logger } from '../logger';
import type { MemoryStore } from '../memory/store';

/**
 * Anonymer Sammel-Endpoint für Nutzungs-Events aus der Extension (Slash-
 * Befehl genutzt, Dashboard-Aktion ausgeführt, Standardfrage gespeichert) —
 * einsehbar aggregiert in der Admin-UI (routes/admin.ts GET /stats).
 *
 * DATENSCHUTZ: BEWUSST ohne User-Header (anders als /api/memory) und ohne
 * Frage-/Antwort-Inhalte — nur Metrik+Key, gegen eine feste Whitelist
 * validiert (usageEventsRequestSchema aus @openvizpilot/shared). Der Server
 * kennt hier keine Identität, nur einen Tages-Zähler pro (Metrik, Key).
 */
export function createStatsRoute(memoryStore: MemoryStore | null, logger: Logger): Hono {
  const app = new Hono();

  app.post(
    '/',
    zValidator('json', usageEventsRequestSchema, (result, c) => {
      if (!result.success) {
        return c.json({ error: 'Ungültige Events' }, 400);
      }
      return undefined;
    }),
    async (c) => {
      const { events } = c.req.valid('json');
      if (memoryStore && events.length > 0) {
        try {
          await memoryStore.recordUsage(events);
        } catch (err) {
          logger.warn('usage recording failed', { name: err instanceof Error ? err.name : 'unknown' });
        }
      }
      // Ohne Store: stiller No-Op (kein Fehler an den Client — reine
      // Statistik darf den Chat-Betrieb nie beeinträchtigen).
      return c.body(null, 204);
    },
  );

  return app;
}
