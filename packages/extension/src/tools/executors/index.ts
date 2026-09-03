import {
  AGGREGATE_DEFAULT_MAX_ROWS,
  MARKS_DEFAULT_MAX_ROWS,
  SUMMARY_DEFAULT_MAX_ROWS,
  rowsToMarkdownTable,
  toolArgSchemas,
  type ToolName,
} from '@openvizpilot/shared';
import type { z } from 'zod';
import type { Dashboard } from '../../tableau/api';
import { describeFilter, describeParameter } from '../../tableau/context-snapshot';
import {
  MAX_AGGREGATE_SOURCE_ROWS,
  findWorksheet,
  readAllSummaryPages,
  readSummaryRows,
  tableToRows,
} from './helpers';

type ArgsOf<N extends ToolName> = z.infer<(typeof toolArgSchemas)[N]>;

export type ToolExecutors = {
  [N in ToolName]: (args: ArgsOf<N>, dashboard: Dashboard) => Promise<string>;
};

export const executors: ToolExecutors = {
  async list_worksheets(_args, dashboard) {
    if (dashboard.worksheets.length === 0) return 'Das Dashboard enthält keine Worksheets.';
    return dashboard.worksheets.map((w) => `- ${w.name}`).join('\n');
  },

  async get_worksheet_fields(args, dashboard) {
    const ws = findWorksheet(dashboard, args.worksheet);
    // Reader mit 1 Zeile: liefert Spalten + Typen, die Datenzeile wird verworfen.
    const result = await readSummaryRows(ws, 1);
    if (result.headers.length === 0) {
      return result.totalRowCount === 0
        ? `"${ws.name}" liefert aktuell keine Zeilen — Spalten nicht ermittelbar (Filter zu restriktiv?).`
        : `Worksheet "${ws.name}" hat keine Spalten.`;
    }
    return [
      `Spalten von "${ws.name}" (aggregierte Ansicht, ${result.totalRowCount} Zeilen):`,
      ...result.headers.map((h, i) => `- ${h} (${result.columnTypes[i] ?? 'unbekannt'})`),
    ].join('\n');
  },

  async get_worksheet_summary_data(args, dashboard) {
    const ws = findWorksheet(dashboard, args.worksheet);
    const maxRows = args.maxRows ?? SUMMARY_DEFAULT_MAX_ROWS;
    const result = await readSummaryRows(ws, maxRows, args.columns);
    if (result.headers.length === 0 && result.totalRowCount === 0) {
      return `"${ws.name}" liefert aktuell keine Zeilen (möglicherweise filtern die aktiven Filter alles heraus).`;
    }
    const table = rowsToMarkdownTable(result.headers, result.rows, { maxRows });
    const parts = [table];
    parts.push(`\nZeige ${result.rows.length} von ${result.totalRowCount} Zeilen.`);
    if (result.missingColumns.length > 0) {
      parts.push(`Nicht gefundene Spalten: ${result.missingColumns.join(', ')}.`);
    }
    return parts.join('\n');
  },

  async get_filters(args, dashboard) {
    const worksheets = args.worksheet
      ? [findWorksheet(dashboard, args.worksheet)]
      : dashboard.worksheets;
    const lines: string[] = [];
    for (const ws of worksheets) {
      const filters = await ws.getFiltersAsync();
      if (filters.length === 0) continue;
      lines.push(`**${ws.name}**`);
      for (const f of filters) {
        lines.push(`- ${describeFilter(f)}`);
      }
    }
    return lines.length > 0 ? lines.join('\n') : 'Keine aktiven Filter.';
  },

  async get_parameters(_args, dashboard) {
    const params = await dashboard.getParametersAsync();
    if (params.length === 0) return 'Das Dashboard hat keine Parameter.';
    return params.map((p) => `- ${describeParameter(p)}`).join('\n');
  },

  async get_selected_marks(args, dashboard) {
    const ws = findWorksheet(dashboard, args.worksheet);
    const maxRows = args.maxRows ?? MARKS_DEFAULT_MAX_ROWS;
    const marks = await ws.getSelectedMarksAsync();
    const tables = marks.data.filter((t) => t.data.length > 0);
    if (tables.length === 0) {
      return `In "${ws.name}" sind aktuell keine Marks selektiert.`;
    }
    const parts: string[] = [];
    for (const t of tables) {
      const { headers, rows } = tableToRows(t, maxRows);
      parts.push(rowsToMarkdownTable(headers, rows, { maxRows }));
      if (t.data.length > rows.length) {
        parts.push(`_Zeige ${rows.length} von ${t.data.length} selektierten Zeilen._`);
      }
    }
    return parts.join('\n\n');
  },

  async get_datasource_info(args, dashboard) {
    const ws = findWorksheet(dashboard, args.worksheet);
    const sources = await ws.getDataSourcesAsync();
    if (sources.length === 0) return `Keine Datenquellen für "${ws.name}" gefunden.`;
    const parts: string[] = [];
    for (const ds of sources) {
      parts.push(`**Datenquelle: ${ds.name}**`);
      const visible = ds.fields.filter((f) => !f.isHidden);
      parts.push(
        rowsToMarkdownTable(
          ['Feld', 'Rolle', 'Aggregation'],
          visible.map((f) => [f.name, f.role ?? '', f.aggregation ?? '']),
          { maxRows: 200 },
        ),
      );
    }
    return parts.join('\n\n');
  },

  async aggregate_summary_data(args, dashboard) {
    const ws = findWorksheet(dashboard, args.worksheet);
    const result = await readAllSummaryPages(ws);
    if (result.totalRowCount === 0) {
      return `"${ws.name}" liefert aktuell keine Zeilen (möglicherweise filtern die aktiven Filter alles heraus).`;
    }

    // Spalten von groupBy/measures per fieldName auflösen; fehlende Spalten
    // führen zu einem selbstkorrigierenden Fehler wie in findWorksheet.
    const columnIndex = (fieldName: string): number =>
      result.columns.find((c) => c.fieldName === fieldName)?.index ?? -1;

    const missing = new Set<string>();
    const groupByIndices = args.groupBy.map((name) => {
      const idx = columnIndex(name);
      if (idx === -1) missing.add(name);
      return idx;
    });
    const measureIndices = args.measures.map((m) => {
      const idx = columnIndex(m.column);
      if (idx === -1) missing.add(m.column);
      return idx;
    });
    if (missing.size > 0) {
      const available = result.columns.map((c) => `"${c.fieldName}"`).join(', ');
      const wanted = [...missing].map((m) => `"${m}"`).join(', ');
      throw new Error(`Spalte(n) ${wanted} nicht gefunden in "${ws.name}". Verfügbare Spalten: ${available}`);
    }

    interface MeasureAcc {
      sum: number;
      numericCount: number;
      min: number;
      max: number;
    }
    interface GroupAcc {
      key: string[];
      rowCount: number;
      /** Ein Accumulator pro Measure, positionsgleich zu args.measures. */
      measures: MeasureAcc[];
    }
    const groups = new Map<string, GroupAcc>();

    for (const row of result.rows) {
      const key = groupByIndices.map((i) => row[i]?.formattedValue ?? '');
      // JSON-Key statt join(): sonst koennten z. B. ["a","bc"] und ["ab","c"] kollidieren.
      const groupKey = JSON.stringify(key);
      let group = groups.get(groupKey);
      if (!group) {
        group = {
          key,
          rowCount: 0,
          measures: measureIndices.map(() => ({
            sum: 0,
            numericCount: 0,
            min: Number.POSITIVE_INFINITY,
            max: Number.NEGATIVE_INFINITY,
          })),
        };
        groups.set(groupKey, group);
      }
      group.rowCount += 1;
      measureIndices.forEach((idx, mi) => {
        const acc = group.measures[mi];
        if (!acc) return;
        const raw = row[idx]?.value;
        // NULL/leer NICHT als 0 werten (Number(null) === 0!) — solche Zellen
        // werden bei sum/avg/min/max übersprungen; count zählt die Zeile trotzdem.
        if (raw == null || raw === '') return;
        const num = typeof raw === 'number' ? raw : Number(raw);
        if (Number.isNaN(num)) return;
        acc.sum += num;
        acc.numericCount += 1;
        if (num < acc.min) acc.min = num;
        if (num > acc.max) acc.max = num;
      });
    }

    const aggregated = [...groups.values()].map((group) => {
      const values = args.measures.map((m, mi) => {
        const acc = group.measures[mi];
        if (m.agg === 'count') return group.rowCount;
        if (!acc || acc.numericCount === 0) return 0;
        switch (m.agg) {
          case 'sum':
            return acc.sum;
          case 'avg':
            return Math.round((acc.sum / acc.numericCount) * 100) / 100;
          case 'min':
            return acc.min;
          case 'max':
            return acc.max;
        }
      });
      return { key: group.key, values };
    });

    // Sortierung: erstes Measure absteigend.
    aggregated.sort((a, b) => (b.values[0] ?? 0) - (a.values[0] ?? 0));

    const maxRows = args.maxRows ?? AGGREGATE_DEFAULT_MAX_ROWS;
    const totalGroups = aggregated.length;
    const shown = aggregated.slice(0, maxRows);

    const headers = [...args.groupBy, ...args.measures.map((m) => `${m.agg}(${m.column})`)];
    const rows = shown.map((g) => [...g.key, ...g.values.map((v) => String(v))]);

    const parts = [rowsToMarkdownTable(headers, rows, { maxRows })];
    parts.push(`\n${totalGroups} Gruppen aus ${result.rows.length} Zeilen.`);
    if (result.truncated) {
      parts.push(
        `Achtung: Es wurden nur die ersten ${MAX_AGGREGATE_SOURCE_ROWS} Quellzeilen berücksichtigt — der Datensatz ist größer, die Aggregation ist ggf. unvollständig.`,
      );
    }
    if (totalGroups > shown.length) {
      parts.push(`Zeige ${shown.length} von ${totalGroups} Gruppen.`);
    }
    return parts.join('\n');
  },
};
