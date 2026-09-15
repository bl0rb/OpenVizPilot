import { z } from 'zod';

export const tableauSearchSchema = z.object({
  query: z.string().max(200).default(''),
  type: z.enum(['all', 'workbook', 'view']).default('all'),
  project: z.string().max(200).optional(),
  owner: z.string().max(200).optional(),
  tag: z.string().max(100).optional(),
  limit: z.number().int().min(1).max(50).default(20),
}).strict();

export type TableauSearchInput = z.input<typeof tableauSearchSchema>;

export interface TableauContent {
  type: 'workbook' | 'view' | 'project' | 'datasource';
  id: string;
  name: string;
  url?: string;
  project?: { id: string; name?: string };
  owner?: { id: string; name?: string };
  tags: string[];
  updatedAt?: string;
}

export interface TableauSearchResult {
  source: 'Tableau Server';
  retrievedAt: string;
  items: TableauContent[];
  truncated: boolean;
  scanned: number;
  limitations: string[];
}
