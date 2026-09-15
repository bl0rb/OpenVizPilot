import { z } from 'zod';

const metadataId = z.string().min(1).max(200).refine(value => value.trim().length > 0);

export const tableauMetadataSearchSchema = z.object({
  query: z.string().max(200).default(''),
  datasourceId: metadataId.optional(),
  limit: z.number().int().min(1).max(50).default(20),
}).strict();

export const tableauMetadataFieldSchema = z.object({ fieldId: metadataId }).strict();

export type TableauMetadataSearchInput = z.input<typeof tableauMetadataSearchSchema>;
export type TableauMetadataFieldInput = z.input<typeof tableauMetadataFieldSchema>;
