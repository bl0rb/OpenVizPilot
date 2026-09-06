import { z } from 'zod';

/**
 * Slash commands: prompt presets following the playbook pattern
 * (goal → approach → format). Types, validation and built-in defaults live
 * here centrally because both the server (admin management, routes/admin.ts,
 * routes/commands.ts) and the extension (fallback, extension/src/chat/commands-client.ts)
 * need them.
 *
 * The expansion itself (placeholder → finished prompt) stays in the
 * extension (chat/slash-commands.ts) — it works purely client-side on a list
 * passed in from the caller (server-loaded or defaults).
 */

export const MAX_SLASH_COMMANDS = 20;
export const MAX_SLASH_COMMAND_DESCRIPTION_CHARS = 80;
export const MAX_SLASH_COMMAND_ARG_HINT_CHARS = 40;
export const MIN_SLASH_COMMAND_TEMPLATE_CHARS = 10;
export const MAX_SLASH_COMMAND_TEMPLATE_CHARS = 1500;

export const slashCommandSchema = z.object({
  /** Name without a leading slash — lowercase letters, numbers, dash. */
  name: z.string().regex(/^[a-z0-9-]{1,32}$/, 'Only a-z, 0-9 and "-", max. 32 characters'),
  /** Short description for the menu. */
  description: z.string().min(1).max(MAX_SLASH_COMMAND_DESCRIPTION_CHARS),
  /** Placeholder hint for arguments (display only). */
  argHint: z.string().max(MAX_SLASH_COMMAND_ARG_HINT_CHARS).optional(),
  /** Prompt template; {{args}} is replaced by the input after the command. */
  template: z.string().min(MIN_SLASH_COMMAND_TEMPLATE_CHARS).max(MAX_SLASH_COMMAND_TEMPLATE_CHARS),
});

export type SlashCommand = z.infer<typeof slashCommandSchema>;

/** List of slash commands — at most MAX_SLASH_COMMANDS, names unique. */
export const slashCommandListSchema = z
  .array(slashCommandSchema)
  .max(MAX_SLASH_COMMANDS)
  .superRefine((commands, ctx) => {
    const seen = new Set<string>();
    commands.forEach((c, i) => {
      if (seen.has(c.name)) {
        ctx.addIssue({
          code: 'custom',
          message: `Doppelter Befehlsname: ${c.name}`,
          path: [i, 'name'],
        });
      }
      seen.add(c.name);
    });
  });

/** Built-in defaults, used until the server configures its own playbooks. */
export const DEFAULT_SLASH_COMMANDS: SlashCommand[] = [
  {
    name: 'zusammenfassung',
    description: 'Management summary of the dashboard',
    template:
      'Goal: Create a concise management summary of this dashboard. Approach: Read the key metrics and active filters; inspect the most relevant worksheets with tools. Format: 3–5 key statements as bullet points, followed by a compact metrics table with each figure tied to the source worksheet.',
  },
  {
    name: 'summary',
    description: 'Management summary of the dashboard',
    template:
      'Goal: Create a concise management summary of this dashboard. Approach: Read the key metrics and active filters; inspect the most relevant worksheets with tools. Format: 3–5 key statements as bullet points, followed by a compact metrics table with each figure tied to the source worksheet.',
  },
  {
    name: 'auffaelligkeiten',
    description: 'Top-3 anomalies with drilldown',
    template:
      'Goal: Find the three biggest anomalies in the data (outliers, unusual ratios, top/bottom performers). Approach: Get an overview with tools and drill down with aggregate_summary_data for the relevant dimensions. Format: One heading per anomaly, the supporting figures with their source and an assessment of whether action is needed.',
  },
  {
    name: 'anomalies',
    description: 'Top-3 anomalies with drilldown',
    template:
      'Goal: Find the three biggest anomalies in the data (outliers, unusual ratios, top/bottom performers). Approach: Get an overview with tools and drill down with aggregate_summary_data for the relevant dimensions. Format: One heading per anomaly, the supporting figures with their source and an assessment of whether action is needed.',
  },
  {
    name: 'vergleich',
    description: 'Compare two segments/regions/time ranges',
    argHint: '<A> <B>',
    template:
      'Goal: Create a robust comparison of {{args}}. Approach: Use aggregate_summary_data to derive the relevant metrics for each comparison group and keep active filters in mind. Format: A comparison table (metric · A · B · difference absolute/%) followed by 2–3 sentences explaining what drives the gap.',
  },
  {
    name: 'compare',
    description: 'Compare two segments/regions/time ranges',
    argHint: '<A> <B>',
    template:
      'Goal: Create a robust comparison of {{args}}. Approach: Use aggregate_summary_data to derive the relevant metrics for each comparison group and keep active filters in mind. Format: A comparison table (metric · A · B · difference absolute/%) followed by 2–3 sentences explaining what drives the gap.',
  },
  {
    name: 'top',
    description: 'Top-N analysis of a dimension',
    argHint: '<N> <Dimension>',
    template:
      'Goal: Create a top-N analysis for {{args}}. Approach: Use aggregate_summary_data with a suitable grouping and rank by the most relevant metric. Format: A ranked table with each item’s share of the total and a sentence about concentration (for example, how much the top entries account for).',
  },
  {
    name: 'massnahmen',
    description: 'Prioritized action recommendations',
    template:
      'Goal: Derive concrete next steps from the data. Approach: Identify the biggest opportunities and problem areas with tools (weak segments, unusual shifts). Format: Up to 3 prioritized recommendations, each with the underlying evidence (figure + source) and the expected effect. No recommendation without evidence from this dashboard.',
  },
  {
    name: 'actions',
    description: 'Prioritized action recommendations',
    template:
      'Goal: Derive concrete next steps from the data. Approach: Identify the biggest opportunities and problem areas with tools (weak segments, unusual shifts). Format: Up to 3 prioritized recommendations, each with the underlying evidence (figure + source) and the expected effect. No recommendation without evidence from this dashboard.',
  },
  {
    name: 'bericht',
    description: 'Formatted report ready to copy',
    template:
      'Goal: Produce a polished short report for this dashboard. Approach: Gather key figures and noteworthy findings with tools. Format: Heading, overview paragraph, metrics table, section “Findings”, section “Recommendation” — factual tone, all figures tied to the source worksheet. End by naming the active filters as the data snapshot.',
  },
  {
    name: 'report',
    description: 'Formatted report ready to copy',
    template:
      'Goal: Produce a polished short report for this dashboard. Approach: Gather key figures and noteworthy findings with tools. Format: Heading, overview paragraph, metrics table, section “Findings”, section “Recommendation” — factual tone, all figures tied to the source worksheet. End by naming the active filters as the data snapshot.',
  },
  {
    name: 'datenqualitaet',
    description: 'Explain gaps and filter effects',
    template:
      'Goal: Assess the data quality of this dashboard. Approach: Check for obvious gaps (empty values, missing groups) and whether active filters or parameters hide part of the data. Format: List of findings with likely causes and a note on what viewers should keep in mind when interpreting the results.',
  },
  {
    name: 'data-quality',
    description: 'Explain gaps and filter effects',
    template:
      'Goal: Assess the data quality of this dashboard. Approach: Check for obvious gaps (empty values, missing groups) and whether active filters or parameters hide part of the data. Format: List of findings with likely causes and a note on what viewers should keep in mind when interpreting the results.',
  },
];
