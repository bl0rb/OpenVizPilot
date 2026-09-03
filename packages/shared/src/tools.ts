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
        'Get the data of the marks the user has currently selected (clicked/highlighted) in a worksheet. Returns an explicit note if nothing is selected.',
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
        'Get metadata about the data sources of a worksheet: data source name and its fields (name, role, aggregation). No row data.',
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
];
