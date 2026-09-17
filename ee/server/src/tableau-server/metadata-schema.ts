import { z } from 'zod';

const metadataId = z.string().min(1).max(200).refine(value => value.trim().length > 0);

const dashboardKeySchema = z.string().min(1).max(200).optional();

export const tableauMetadataSearchSchema = z.object({
  query: z.string().max(200).default(''),
  datasourceId: metadataId.optional(),
  limit: z.number().int().min(1).max(50).default(20),
  /** Löst die Tableau-Site auf (mehrere Sites möglich); ohne Angabe genügt genau eine konfigurierte Site. */
  dashboardKey: dashboardKeySchema,
}).strict();

export const tableauMetadataFieldSchema = z.object({ fieldId: metadataId, dashboardKey: dashboardKeySchema }).strict();

export type TableauMetadataSearchInput = z.input<typeof tableauMetadataSearchSchema>;
export type TableauMetadataFieldInput = z.input<typeof tableauMetadataFieldSchema>;
