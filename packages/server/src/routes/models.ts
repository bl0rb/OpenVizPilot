import type { ModelOption } from '@openvizpilot/shared';
import { Hono } from 'hono';
import type OpenAI from 'openai';
import type { AppConfig } from '../env';
import { effectiveDefaultModel } from './chat';
import type { Logger } from '../logger';
import type { MemoryStore } from '../memory/store';

const CACHE_TTL_MS = 60_000;

/**
 * GET /api/models — die Modellauswahl der Extension.
 *
 * Hat der Admin in der Admin-UI einen Modell-Katalog gespeichert (IDs +
 * Anzeigenamen, siehe @openvizpilot/shared/models.ts), liefert die Route NUR
 * diesen — ohne Upstream-Call. Ohne Katalog gilt wie bisher die Liste des
 * OpenAI-kompatiblen Endpunkts (60 s gecacht), gefiltert über MODEL_ALLOWLIST;
 * die Anzeigenamen sind dann die rohen Modell-IDs.
 */
export function createModelsRoute(
  config: AppConfig,
  logger: Logger,
  client: OpenAI,
  memoryStore: MemoryStore | null,
): Hono {
  const app = new Hono();
  let cache: { at: number; models: ModelOption[] } | null = null;

  const asOptions = (ids: string[]): ModelOption[] => ids.map((id) => ({ id, label: id }));

  app.get('/', async (c) => {
    if (memoryStore) {
      try {
        const catalog = await memoryStore.getModelCatalog();
        if (catalog) {
          // Effektives Default konsistent zur Chat-Route: schließt der
          // Katalog DEFAULT_MODEL aus, ist sein erster Eintrag der Standard.
          return c.json({
            models: catalog,
            defaultModel: effectiveDefaultModel(config.defaultModel, catalog),
          });
        }
      } catch (err) {
        // Katalog nicht lesbar (DB down): auf den Upstream-Pfad zurückfallen,
        // damit die Modellauswahl nicht an der Memory-DB hängt.
        logger.warn('model catalog read failed, falling back to upstream list', {
          name: err instanceof Error ? err.name : 'unknown',
        });
      }
    }
    if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
      return c.json({ models: cache.models, defaultModel: config.defaultModel });
    }
    try {
      const list = await client.models.list();
      let ids = list.data.map((m) => m.id).sort((a, b) => a.localeCompare(b));
      if (config.modelAllowlist) {
        const allow = new Set(config.modelAllowlist);
        ids = ids.filter((id) => allow.has(id));
      }
      const models = asOptions(ids);
      cache = { at: Date.now(), models };
      return c.json({ models, defaultModel: config.defaultModel });
    } catch (err) {
      logger.warn('models list failed, falling back', {
        name: err instanceof Error ? err.name : 'unknown',
      });
      const fallback = asOptions(config.modelAllowlist ?? [config.defaultModel]);
      return c.json({ models: fallback, defaultModel: config.defaultModel });
    }
  });

  return app;
}
