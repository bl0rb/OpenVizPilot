import { z } from 'zod';

export const tableauSearchSchema = z.object({
  query: z.string().max(200).default(''),
  type: z.enum(['all', 'workbook', 'view']).default('all'),
  project: z.string().max(200).optional(),
  owner: z.string().max(200).optional(),
  tag: z.string().max(100).optional(),
  limit: z.number().int().min(1).max(50).default(20),
  /** Löst die Tableau-Site auf (mehrere Sites möglich); ohne Angabe genügt genau eine konfigurierte Site. */
  dashboardKey: z.string().min(1).max(200).optional(),
}).strict();

export type TableauSearchInput = z.input<typeof tableauSearchSchema>;

/** Body von POST /api/tableau-server/check — Site-Auflösung wie bei den übrigen Extension-Routen. */
export const tableauCheckSchema = z.object({
  dashboardKey: z.string().min(1).max(200).optional(),
  /** Nur von der Admin-UI genutzt, um eine Site direkt (statt über eine Dashboard-Zuordnung) zu testen. */
  siteId: z.string().min(1).max(20).optional(),
}).strict();
export type TableauCheckInput = z.input<typeof tableauCheckSchema>;

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
