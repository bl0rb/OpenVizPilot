import { z } from 'zod';

/**
 * Tool-Vertrag zwischen Middleware und Extension.
 *
 * Die Middleware injiziert `toolDefinitions` in jeden LiteLLM-Call — der Client
 * sendet keine Tool-Schemas mit und kann sie damit auch nicht manipulieren.
 * Die Extension nutzt `toolArgSchemas` zur Validierung der Argumente vor der
 * Ausführung gegen die Extensions API.
 *
 * Alle Tools sind read-only (Prompt-Injection-Prämisse: keine Schreibaktionen).
 */

export const SUMMARY_DEFAULT_MAX_ROWS = 200;
export const SUMMARY_MAX_ROWS_LIMIT = 1000;
export const MARKS_DEFAULT_MAX_ROWS = 100;
export const AGGREGATE_DEFAULT_MAX_ROWS = 50;
export const AGGREGATE_MAX_ROWS_LIMIT = 200;
export const BREAKDOWN_DEFAULT_MAX_GROUPS = 15;
export const BREAKDOWN_MAX_GROUPS_LIMIT = 50;
export const COMPARE_PERIODS_MAX_GROUPS = 30;

export const toolArgSchemas = {
  list_worksheets: z.object({}),
  get_worksheet_fields: z.object({
    worksheet: z.string().min(1),
  }),
  get_worksheet_summary_data: z.object({
    worksheet: z.string().min(1),
    maxRows: z.number().int().min(1).max(SUMMARY_MAX_ROWS_LIMIT).optional(),
    columns: z.array(z.string().min(1)).max(50).optional(),
  }),
  get_filters: z.object({
    worksheet: z.string().min(1).optional(),
  }),
  get_parameters: z.object({}),
  get_selected_marks: z.object({
    worksheet: z.string().min(1),
    maxRows: z.number().int().min(1).max(SUMMARY_MAX_ROWS_LIMIT).optional(),
  }),
  get_datasource_info: z.object({
    worksheet: z.string().min(1),
  }),
  aggregate_summary_data: z.object({
    worksheet: z.string().min(1),
    groupBy: z.array(z.string().min(1)).min(1).max(3),
    measures: z
      .array(
        z.object({
          column: z.string().min(1),
          agg: z.enum(['sum', 'avg', 'min', 'max', 'count']),
        }),
      )
      .min(1)
      .max(4),
    maxRows: z.number().int().min(1).max(AGGREGATE_MAX_ROWS_LIMIT).optional(),
  }),
  /**
   * Trust Layer (Kennzahlenkatalog, siehe metrics.ts): schlägt die
   * unternehmensweit verbindliche Definition einer Kennzahl nach. Nur in der
   * Tool-Liste, wenn der Admin-Katalog nicht leer ist — siehe
   * LOOKUP_METRIC_TOOL unten und server/src/routes/chat.ts.
   */
  lookup_metric: z.object({
    query: z.string().min(1).max(80),
  }),
  /**
   * Untersuchungsmodus (W3): Aufschlüsselung einer Kennzahl nach einer
   * Dimension — Gruppen absteigend sortiert, kleinste Gruppen ab maxGroups zu
   * "Übrige (N)" zusammengefasst. Auch im ask-Modus verfügbar, siehe tools.ts
   * (toolDefinitions werden unabhängig vom mode gesendet).
   */
  breakdown_by: z.object({
    worksheet: z.string().min(1),
    dimension: z.string().min(1),
    measure: z.string().min(1),
    agg: z.enum(['sum', 'avg', 'count']).optional(),
    maxGroups: z.number().int().min(1).max(BREAKDOWN_MAX_GROUPS_LIMIT).optional(),
  }),
  /**
   * Untersuchungsmodus (W3): Vergleich einer Kennzahl zwischen zwei
   * Zeiträumen (halboffen: from <= Datum < to), optional je Gruppe.
   */
  compare_periods: z.object({
    worksheet: z.string().min(1),
    dateColumn: z.string().min(1),
    measure: z.string().min(1),
    agg: z.enum(['sum', 'avg', 'count']).optional(),
    periodA: z.object({ from: z.string().min(1), to: z.string().min(1) }),
    periodB: z.object({ from: z.string().min(1), to: z.string().min(1) }),
    groupBy: z.string().min(1).optional(),
  }),
} as const;

export type ToolName = keyof typeof toolArgSchemas;

export const toolNames = Object.keys(toolArgSchemas) as ToolName[];

export function isToolName(name: string): name is ToolName {
  return Object.prototype.hasOwnProperty.call(toolArgSchemas, name);
}

/** OpenAI-kompatible Tool-Definitionen (werden 1:1 an LiteLLM gereicht). */
export interface ToolDefinition {
  type: 'function';
  function: {
    name: ToolName;
    description: string;
    parameters: Record<string, unknown>;
  };
}

const worksheetParam = {
  type: 'string',
  description: 'Exact name of the worksheet as shown in the dashboard.',
};

/** Halboffener Zeitraum (from <= Datum < to) für compare_periods — Datumsparsing ist tolerant (ISO, YYYY-MM-DD). */
const periodParam = {
  type: 'object',
  properties: {
    from: { type: 'string', minLength: 1, description: 'Start date (inclusive), e.g. "2024-01-01" or an ISO timestamp.' },
    to: { type: 'string', minLength: 1, description: 'End date (exclusive), e.g. "2024-04-01" or an ISO timestamp.' },
  },
  required: ['from', 'to'],
  additionalProperties: false,
};

export const toolDefinitions: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'list_worksheets',
      description:
        'List the names of all worksheets in the currently open dashboard. Use this if a worksheet name from the context seems outdated or a lookup by name failed.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_worksheet_fields',
      description:
        'Get the columns (field names and data types) of the aggregated summary data of one worksheet.',
      parameters: {
        type: 'object',
        properties: { worksheet: worksheetParam },
        required: ['worksheet'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_worksheet_summary_data',
      description:
        'Read the aggregated summary data of one worksheet as a markdown table (the data as currently visible to the user, with all active filters applied). Rows are truncated to maxRows; the footer states the total row count. Use the columns parameter to project only the fields you need.',
      parameters: {
        type: 'object',
        properties: {
          worksheet: worksheetParam,
          maxRows: {
            type: 'integer',
            minimum: 1,
            maximum: SUMMARY_MAX_ROWS_LIMIT,
            description: `Maximum number of rows to return (default ${SUMMARY_DEFAULT_MAX_ROWS}).`,
          },
          columns: {
            type: 'array',
            items: { type: 'string', minLength: 1 },
            maxItems: 50,
            description:
              'Optional list of column names to include (projection, at most 50). Omit for all columns.',
          },
        },
        required: ['worksheet'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_filters',
      description:
        'List the currently active filters (field, filter type, applied values or range, exclude mode) — for all worksheets or one specific worksheet.',
      parameters: {
        type: 'object',
        properties: {
          worksheet: { ...worksheetParam, description: 'Optional: restrict to this worksheet.' },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_parameters',
      description:
        'List all dashboard parameters with their current value, data type and allowed values or range.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_selected_marks',
      description:
        'Get the data of the marks the user has currently selected in a worksheet. If nothing is selected, falls back to the marks that are highlighted (highlighter control, legend click, highlight action) and says so. Returns an explicit note if neither exists.',
      parameters: {
        type: 'object',
        properties: {
          worksheet: worksheetParam,
          maxRows: {
            type: 'integer',
            minimum: 1,
            maximum: SUMMARY_MAX_ROWS_LIMIT,
            description: `Maximum number of rows to return (default ${MARKS_DEFAULT_MAX_ROWS}).`,
          },
        },
        required: ['worksheet'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_datasource_info',
      description:
        'Get metadata about the data sources of a worksheet: data source name, its connections (name and connector type — use this to answer where a number comes from) and its fields (name, role, aggregation). No row data.',
      parameters: {
        type: 'object',
        properties: { worksheet: worksheetParam },
        required: ['worksheet'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'aggregate_summary_data',
      description:
        'Group and aggregate the FULL summary data of a worksheet (all reader pages, not just the first) by up to 3 dimensions, computing sum/avg/min/max/count for up to 4 measures. Use this for drilldowns and comparisons the default aggregated view cannot answer directly — no full-data permission required. Groups are sorted descending by the first measure and truncated to maxRows; the footer states the total group and source row counts.',
      parameters: {
        type: 'object',
        properties: {
          worksheet: worksheetParam,
          groupBy: {
            type: 'array',
            items: { type: 'string', minLength: 1 },
            minItems: 1,
            maxItems: 3,
            description: 'Column names (dimensions) to group by, in order (1-3).',
          },
          measures: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                column: {
                  type: 'string',
                  minLength: 1,
                  description: 'Measure column name as it appears in the worksheet (e.g. "SUM(Umsatz)").',
                },
                agg: {
                  type: 'string',
                  enum: ['sum', 'avg', 'min', 'max', 'count'],
                  description: 'Aggregation function to apply to this measure within each group.',
                },
              },
              required: ['column', 'agg'],
              additionalProperties: false,
            },
            minItems: 1,
            maxItems: 4,
            description: 'Measures to aggregate per group (1-4).',
          },
          maxRows: {
            type: 'integer',
            minimum: 1,
            maximum: AGGREGATE_MAX_ROWS_LIMIT,
            description: `Maximum number of groups to return, sorted descending by the first measure (default ${AGGREGATE_DEFAULT_MAX_ROWS}).`,
          },
        },
        required: ['worksheet', 'groupBy', 'measures'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'breakdown_by',
      description:
        'Break down a measure of a worksheet by one dimension: group by the dimension, aggregate the measure (default sum), sort groups descending by value, collapse the smallest groups beyond maxGroups into a single "Übrige (N)" row, and report each group\'s share of the total plus how much the top 3 groups explain. Use this for drilldown/"why" questions about which values of a dimension drive a number.',
      parameters: {
        type: 'object',
        properties: {
          worksheet: worksheetParam,
          dimension: {
            type: 'string',
            minLength: 1,
            description: 'Dimension column name to group by, as it appears in the worksheet.',
          },
          measure: {
            type: 'string',
            minLength: 1,
            description: 'Measure column name to aggregate (e.g. "SUM(Umsatz)").',
          },
          agg: {
            type: 'string',
            enum: ['sum', 'avg', 'count'],
            description: 'Aggregation function to apply within each group (default sum).',
          },
          maxGroups: {
            type: 'integer',
            minimum: 1,
            maximum: BREAKDOWN_MAX_GROUPS_LIMIT,
            description: `Maximum number of groups to show before collapsing the rest into "Übrige" (default ${BREAKDOWN_DEFAULT_MAX_GROUPS}).`,
          },
        },
        required: ['worksheet', 'dimension', 'measure'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'compare_periods',
      description:
        'Compare a measure of a worksheet between two date ranges (periodA vs. periodB): total per period plus absolute and percentage difference, and — if groupBy is given — the same comparison per group of a dimension, sorted by absolute difference (max 30 groups). Periods are half-open: from <= date < to. Use this for "why did X change between period A and period B" questions.',
      parameters: {
        type: 'object',
        properties: {
          worksheet: worksheetParam,
          dateColumn: {
            type: 'string',
            minLength: 1,
            description: 'Date column name, as it appears in the worksheet.',
          },
          measure: {
            type: 'string',
            minLength: 1,
            description: 'Measure column name to aggregate (e.g. "SUM(Umsatz)").',
          },
          agg: {
            type: 'string',
            enum: ['sum', 'avg', 'count'],
            description: 'Aggregation function to apply (default sum).',
          },
          periodA: periodParam,
          periodB: periodParam,
          groupBy: {
            type: 'string',
            minLength: 1,
            description: 'Optional dimension column to break the comparison down by, as it appears in the worksheet.',
          },
        },
        required: ['worksheet', 'dateColumn', 'measure', 'periodA', 'periodB'],
        additionalProperties: false,
      },
    },
  },
];

/**
 * Eigenständig (nicht Teil von toolDefinitions): wird nur an das Modell
 * gereicht, wenn der Admin einen Kennzahlenkatalog gepflegt hat — siehe
 * server/src/routes/chat.ts und system-prompt.ts (<metric_catalog>-Block).
 */
export const LOOKUP_METRIC_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'lookup_metric',
    description:
      'Look up the company-wide binding definition of a metric by name or synonym. Call this before answering anything about a metric from the catalogue.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', minLength: 1, maxLength: 80, description: 'Metric name or synonym as mentioned by the user.' },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
};
