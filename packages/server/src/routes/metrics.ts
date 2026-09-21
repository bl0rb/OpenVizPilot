import { zValidator } from '@hono/zod-validator';
import { toolArgSchemas, type Metric, type MetricSummary } from '@openvizpilot/shared';
import { Hono } from 'hono';
import type { Logger } from '../logger';
import type { MemoryStore } from '../memory/store';

/**
 * Öffentliche, authentifizierte Routen des Kennzahlenkatalogs (Trust Layer,
 * siehe @openvizpilot/shared/metrics.ts) — von der Extension geladen (Badge-
 * Vorprüfung) bzw. vom lookup_metric-Tool-Executor aufgerufen. Läuft unter
 * demselben Auth-Regime wie /api/commands (siehe app.ts), NICHT unter dem
 * separaten Admin-Token — hier stehen keine Dashboard-Daten, nur die vom
 * Admin gepflegten Definitionen.
 *
 * Fällt bei jedem Fehler (kein Store, Datenbank nicht erreichbar, ungültig
 * gespeicherter Wert) still auf einen leeren Katalog zurück statt einen
 * Fehlerstatus zu liefern.
 */
export function createMetricsRoute(memoryStore: MemoryStore | null, logger: Logger): Hono {
  const app = new Hono();

  const loadCatalog = async (): Promise<Metric[]> => {
    if (!memoryStore) return [];
    try {
      return (await memoryStore.getMetricCatalog()) ?? [];
    } catch (err) {
      logger.warn('metric catalog read failed, falling back to empty catalog', {
        name: err instanceof Error ? err.name : 'unknown',
      });
      return [];
    }
  };

  // Kompakte Liste (id, name, synonyms) — reicht der Extension, um zu
  // erkennen, ob ein Katalog aktiv ist; keine Definitionen im Klartext.
  app.get('/', async (c) => {
    const catalog = await loadCatalog();
    const summaries: MetricSummary[] = catalog.map((m) => ({ id: m.id, name: m.name, synonyms: m.synonyms }));
    return c.json({ metrics: summaries });
  });

  app.post(
    '/lookup',
    zValidator('json', toolArgSchemas.lookup_metric, (result, c) => {
      if (!result.success) {
        return c.json({ error: 'Ungültiger Request', details: result.error.issues }, 400);
      }
      return undefined;
    }),
    async (c) => {
      const { query } = c.req.valid('json');
      const catalog = await loadCatalog();
      return c.json({ metrics: findMetricMatches(catalog, query) });
    },
  );

  return app;
}

const MAX_LOOKUP_MATCHES = 3;

/**
 * Beste Treffer für eine Nutzeranfrage: zuerst exakte Name-/Synonym-Treffer
 * (case-insensitive), sonst Teilstring-Treffer — nie beide Kategorien
 * gemischt, jeweils auf MAX_LOOKUP_MATCHES begrenzt in Katalog-Reihenfolge.
 */
export function findMetricMatches(catalog: readonly Metric[], query: string): Metric[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [];
  const exact = catalog.filter(
    (m) => m.name.toLocaleLowerCase() === needle || m.synonyms.some((s) => s.toLocaleLowerCase() === needle),
  );
  if (exact.length > 0) return exact.slice(0, MAX_LOOKUP_MATCHES);
  const partial = catalog.filter(
    (m) => m.name.toLocaleLowerCase().includes(needle) || m.synonyms.some((s) => s.toLocaleLowerCase().includes(needle)),
  );
  return partial.slice(0, MAX_LOOKUP_MATCHES);
}
