import { z } from 'zod';

/**
 * Admin-verwalteter Modell-Katalog: Der Admin wählt in der Admin-UI aus, welche
 * Modelle des OpenAI-kompatiblen Endpunkts die Extension anbietet, und gibt
 * ihnen sprechende Anzeigenamen (z. B. "claude-sonnet-5-20260101" → "Standard
 * (schnell)"). GET /api/models liefert dann NUR diese Einträge; ohne
 * gespeicherten Katalog gilt die Endpunkt-Liste (∩ MODEL_ALLOWLIST) wie bisher.
 *
 * `id` ist die Modell-ID am Endpunkt (geht als `model` in den Chat-Request),
 * `label` der Name, den die Extension im Auswahlmenü zeigt.
 */

export const MAX_MODEL_OPTIONS = 50;
export const MAX_MODEL_ID_CHARS = 200;
export const MAX_MODEL_LABEL_CHARS = 100;

export const modelOptionSchema = z.object({
  id: z.string().min(1).max(MAX_MODEL_ID_CHARS),
  label: z.string().min(1).max(MAX_MODEL_LABEL_CHARS),
});

export const modelCatalogSchema = z
  .array(modelOptionSchema)
  .min(1)
  .max(MAX_MODEL_OPTIONS)
  .refine((list) => new Set(list.map((m) => m.id)).size === list.length, {
    message: 'Modell-IDs müssen eindeutig sein',
  })
  .refine((list) => new Set(list.map((m) => m.label)).size === list.length, {
    message: 'Anzeigenamen müssen eindeutig sein',
  });

export type ModelOption = z.infer<typeof modelOptionSchema>;
