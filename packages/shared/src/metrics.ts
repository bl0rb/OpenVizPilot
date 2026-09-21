import { z } from 'zod';

/**
 * Kennzahlenkatalog (Trust Layer): Der Admin pflegt unternehmensweit
 * verbindliche Kennzahlen-Definitionen (Name, Synonyme, Definition, Owner,
 * Datenquelle, Interpretation, geprüfte Fragen). Der System-Prompt bekommt
 * eine kompakte Rendering dieses Katalogs (siehe renderMetricCatalogForPrompt
 * und system-prompt.ts), das Modell verifiziert einzelne Kennzahlen zusätzlich
 * per Tool-Aufruf `lookup_metric` (packages/shared/src/tools.ts) gegen
 * GET/POST /api/metrics* (packages/server/src/routes/metrics.ts) — nur ein
 * tatsächlicher Tool-Treffer löst in der Extension das
 * „✓ Verifizierte Definition"-Badge aus.
 */

export const MAX_METRICS = 200;
export const MAX_METRIC_NAME_CHARS = 80;
export const MAX_METRIC_SYNONYMS = 10;
export const MAX_METRIC_SYNONYM_CHARS = 40;
export const MAX_METRIC_DEFINITION_CHARS = 1000;
export const MAX_METRIC_OWNER_CHARS = 80;
export const MAX_METRIC_DATASOURCE_CHARS = 120;
export const MAX_METRIC_INTERPRETATION_CHARS = 500;
export const MAX_METRIC_VERIFIED_QUESTIONS = 5;
export const MAX_METRIC_QUESTION_CHARS = 200;
export const MAX_METRIC_ANSWER_GUIDANCE_CHARS = 500;
/** Gesamtbudget von renderMetricCatalogForPrompt — wie MAX_AUTHOR_CONTEXT_CHARS. */
export const METRIC_CATALOG_PROMPT_BUDGET_CHARS = 6000;
/** Für den Kürzungshinweis reservierter Platz am Budget-Ende. */
const METRIC_CATALOG_SUFFIX_RESERVE_CHARS = 60;

export const metricIdSchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]{0,39}$/, 'Nur a-z, 0-9 und "-", muss mit einem Buchstaben beginnen, max. 40 Zeichen');

export const verifiedQuestionSchema = z.object({
  question: z.string().min(1).max(MAX_METRIC_QUESTION_CHARS),
  answerGuidance: z.string().min(1).max(MAX_METRIC_ANSWER_GUIDANCE_CHARS),
});

export type VerifiedQuestion = z.infer<typeof verifiedQuestionSchema>;

export const metricSchema = z.object({
  /** Eindeutiger Slug, dashboardübergreifend — Ziel von lookup_metric. */
  id: metricIdSchema,
  name: z.string().min(1).max(MAX_METRIC_NAME_CHARS),
  synonyms: z.array(z.string().min(1).max(MAX_METRIC_SYNONYM_CHARS)).max(MAX_METRIC_SYNONYMS),
  definition: z.string().min(1).max(MAX_METRIC_DEFINITION_CHARS),
  owner: z.string().max(MAX_METRIC_OWNER_CHARS).optional(),
  datasource: z.string().max(MAX_METRIC_DATASOURCE_CHARS).optional(),
  interpretation: z.string().max(MAX_METRIC_INTERPRETATION_CHARS).optional(),
  verifiedQuestions: z.array(verifiedQuestionSchema).max(MAX_METRIC_VERIFIED_QUESTIONS),
});

export type Metric = z.infer<typeof metricSchema>;

/** Kompakte Sicht für GET /api/metrics (Extension-Erkennung ohne volle Definition). */
export type MetricSummary = Pick<Metric, 'id' | 'name' | 'synonyms'>;

/**
 * Katalog — id und (case-insensitive) Name/Synonyme müssen über ALLE
 * Kennzahlen hinweg eindeutig sein, damit lookup_metric nie mehrdeutig auf
 * denselben Begriff trifft.
 */
export const metricCatalogSchema = z
  .array(metricSchema)
  .max(MAX_METRICS)
  .superRefine((catalog, ctx) => {
    const seenIds = new Set<string>();
    const seenNames = new Map<string, string>();
    catalog.forEach((metric, index) => {
      if (seenIds.has(metric.id)) {
        ctx.addIssue({ code: 'custom', message: `Doppelte ID: ${metric.id}`, path: [index, 'id'] });
      }
      seenIds.add(metric.id);

      const check = (value: string, path: (string | number)[]) => {
        const key = value.toLocaleLowerCase();
        if (seenNames.has(key)) {
          ctx.addIssue({ code: 'custom', message: `Name/Synonym bereits vergeben: ${value}`, path });
        }
        seenNames.set(key, metric.id);
      };
      check(metric.name, [index, 'name']);
      metric.synonyms.forEach((synonym, synonymIndex) => check(synonym, [index, 'synonyms', synonymIndex]));
    });
  });

export type MetricCatalog = z.infer<typeof metricCatalogSchema>;

/**
 * Kompakte Textform des Katalogs für den System-Prompt: eine Zeile je
 * Kennzahl mit Name, Synonymen und Definition (Owner optional), begrenzt auf
 * METRIC_CATALOG_PROMPT_BUDGET_CHARS Zeichen — der Rest wird als Hinweis auf
 * `lookup_metric` zusammengefasst. Delimiter-Escaping (falls der Text in ein
 * <metric_catalog>-Tag eingebettet wird) übernimmt der Aufrufer, siehe
 * system-prompt.ts (gleiches Muster wie bei authorContext).
 */
export function renderMetricCatalogForPrompt(catalog: readonly Metric[]): string {
  if (catalog.length === 0) return '';
  const budget = METRIC_CATALOG_PROMPT_BUDGET_CHARS - METRIC_CATALOG_SUFFIX_RESERVE_CHARS;
  const lines: string[] = [];
  let used = 0;
  let index = 0;
  for (; index < catalog.length; index++) {
    const metric = catalog[index]!;
    const synonymPart = metric.synonyms.length > 0 ? ` (${metric.synonyms.join(', ')})` : '';
    const ownerPart = metric.owner ? ` [Owner: ${metric.owner}]` : '';
    const line = `- ${metric.name}${synonymPart}: ${metric.definition}${ownerPart}`;
    const addedChars = line.length + (lines.length > 0 ? 1 : 0);
    if (used + addedChars > budget) break;
    lines.push(line);
    used += addedChars;
  }
  const omitted = catalog.length - index;
  let result = lines.join('\n');
  if (omitted > 0) {
    result += `${lines.length > 0 ? '\n' : ''}… und ${omitted} weitere — per lookup_metric abrufbar`;
  }
  return result;
}
