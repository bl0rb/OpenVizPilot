import {
  AGGREGATE_DEFAULT_MAX_ROWS,
  BREAKDOWN_DEFAULT_MAX_GROUPS,
  COMPARE_PERIODS_MAX_GROUPS,
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
  parseTolerantDate,
  readAllSummaryPages,
  readSummaryRows,
  resolveColumnIndices,
  tableToRows,
} from './helpers';
import { executeLookupMetric, type MetricLookupNetwork } from './metrics';

type ArgsOf<N extends ToolName> = z.infer<(typeof toolArgSchemas)[N]>;

/** Netzwerk-Kontext für Tools, die (anders als die übrigen, dashboard-lokalen Tools) einen Server-Call brauchen — aktuell nur `lookup_metric` (W1 Trust Layer). */
export type ToolNetworkContext = MetricLookupNetwork;

export type ToolExecutors = {
  [N in ToolName]: (args: ArgsOf<N>, dashboard: Dashboard, network: ToolNetworkContext) => Promise<string>;
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
    const selected = await ws.getSelectedMarksAsync();
    let tables = selected.data.filter((t) => t.data.length > 0);
    let highlighted = false;

    // Tableau kennt zwei Zustände: angeklickt (Selektion) und hervorgehoben
    // (Highlighter, Legendenklick, Highlight-Aktion zwischen Blättern). Ohne
    // diesen Rückfall meldet der Assistent „nichts ausgewählt", während der
    // Anwender sichtbar etwas hervorgehoben hat.
    if (tables.length === 0 && ws.getHighlightedMarksAsync) {
      const marks = await ws.getHighlightedMarksAsync().catch(() => null);
      const found = marks?.data.filter((t) => t.data.length > 0) ?? [];
      if (found.length > 0) {
        tables = found;
        highlighted = true;
      }
    }

    if (tables.length === 0) {
      return `In "${ws.name}" sind aktuell keine Marks selektiert oder hervorgehoben.`;
    }

    const parts: string[] = [];
    if (highlighted) {
      // Herkunft benennen, damit das Modell in der Antwort nicht „ausgewählt" schreibt.
      parts.push('_Nichts selektiert — die folgenden Marks sind im Worksheet hervorgehoben._');
    }
    for (const t of tables) {
      const { headers, rows } = tableToRows(t, maxRows);
      parts.push(rowsToMarkdownTable(headers, rows, { maxRows }));
      if (t.data.length > rows.length) {
        const what = highlighted ? 'hervorgehobenen' : 'selektierten';
        parts.push(`_Zeige ${rows.length} von ${t.data.length} ${what} Zeilen._`);
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
      // Verbindungsart beantwortet die häufigste Vertrauensfrage („woher kommt
      // diese Zahl?"). Bewusst OHNE serverURI: Ein interner Hostname hat im
      // Prompt nichts verloren, der Connector-Typ genügt für die Antwort.
      if (ds.getConnectionSummariesAsync) {
        const connections = await ds.getConnectionSummariesAsync().catch(() => []);
        if (connections.length > 0) {
          parts.push(`Verbindungen: ${connections.map((c) => `${c.name} (${c.type})`).join(', ')}`);
        }
      }
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

  async lookup_metric(args, _dashboard, network) {
    return executeLookupMetric(args, network);
  },

  async breakdown_by(args, dashboard) {
    const ws = findWorksheet(dashboard, args.worksheet);
    const result = await readAllSummaryPages(ws);
    if (result.totalRowCount === 0) {
      return `"${ws.name}" liefert aktuell keine Zeilen (möglicherweise filtern die aktiven Filter alles heraus).`;
    }
    const [dimIdx, measureIdx] = resolveColumnIndices(ws.name, result.columns, [args.dimension, args.measure]);

    const agg = args.agg ?? 'sum';
    interface Acc {
      sum: number;
      numericCount: number;
      rowCount: number;
    }
    const groups = new Map<string, Acc>();
    for (const row of result.rows) {
      const key = row[dimIdx!]?.formattedValue ?? '';
      let acc = groups.get(key);
      if (!acc) {
        acc = { sum: 0, numericCount: 0, rowCount: 0 };
        groups.set(key, acc);
      }
      acc.rowCount += 1;
      const raw = row[measureIdx!]?.value;
      if (raw == null || raw === '') continue;
      const num = typeof raw === 'number' ? raw : Number(raw);
      if (Number.isNaN(num)) continue;
      acc.sum += num;
      acc.numericCount += 1;
    }

    const valueOf = (acc: Acc): number => {
      if (agg === 'count') return acc.rowCount;
      if (acc.numericCount === 0) return 0;
      return agg === 'avg' ? Math.round((acc.sum / acc.numericCount) * 100) / 100 : acc.sum;
    };

    const rows = [...groups.entries()]
      .map(([key, acc]) => ({ key, value: valueOf(acc) }))
      .sort((a, b) => b.value - a.value);

    const total = rows.reduce((s, r) => s + r.value, 0);
    const top3Sum = rows.slice(0, 3).reduce((s, r) => s + r.value, 0);
    const top3Share = total !== 0 ? (top3Sum / total) * 100 : 0;
    const pct = (v: number): string => (total !== 0 ? `${((v / total) * 100).toFixed(1)} %` : '0.0 %');

    const maxGroups = args.maxGroups ?? BREAKDOWN_DEFAULT_MAX_GROUPS;
    const shown = rows.slice(0, maxGroups);
    const rest = rows.slice(maxGroups);

    const tableRows = shown.map((r) => [r.key, String(r.value), pct(r.value)]);
    if (rest.length > 0) {
      const restValue = rest.reduce((s, r) => s + r.value, 0);
      tableRows.push([`Übrige (${rest.length})`, String(restValue), pct(restValue)]);
    }

    const parts = [rowsToMarkdownTable([args.dimension, `${agg}(${args.measure})`, 'Anteil %'], tableRows)];
    parts.push(`\n${rows.length} Gruppen aus ${result.rows.length} Zeilen.`);
    parts.push(`Top-3 erklären ${top3Share.toFixed(1)} % des Gesamtwerts.`);
    if (result.truncated) {
      parts.push(
        `Achtung: Es wurden nur die ersten ${MAX_AGGREGATE_SOURCE_ROWS} Quellzeilen berücksichtigt — der Datensatz ist größer, die Aufschlüsselung ist ggf. unvollständig.`,
      );
    }
    return parts.join('\n');
  },

  async compare_periods(args, dashboard) {
    const ws = findWorksheet(dashboard, args.worksheet);
    const result = await readAllSummaryPages(ws);
    if (result.totalRowCount === 0) {
      return `"${ws.name}" liefert aktuell keine Zeilen (möglicherweise filtern die aktiven Filter alles heraus).`;
    }
    const wanted = [args.dateColumn, args.measure, ...(args.groupBy ? [args.groupBy] : [])];
    const indices = resolveColumnIndices(ws.name, result.columns, wanted);
    const dateIdx = indices[0]!;
    const measureIdx = indices[1]!;
    const groupIdx = args.groupBy ? indices[2]! : -1;

    const fromA = parseTolerantDate(args.periodA.from);
    const toA = parseTolerantDate(args.periodA.to);
    const fromB = parseTolerantDate(args.periodB.from);
    const toB = parseTolerantDate(args.periodB.to);
    if (!fromA || !toA || !fromB || !toB) {
      throw new Error(
        `Ungültiges Datum in periodA/periodB — erwartet ISO (z. B. "2024-01-01") oder "YYYY-MM-DD".`,
      );
    }

    const agg = args.agg ?? 'sum';
    interface Acc {
      sum: number;
      numericCount: number;
      rowCount: number;
    }
    const newAcc = (): Acc => ({ sum: 0, numericCount: 0, rowCount: 0 });
    const addTo = (acc: Acc, raw: unknown): void => {
      acc.rowCount += 1;
      if (raw == null || raw === '') return;
      const num = typeof raw === 'number' ? raw : Number(raw);
      if (Number.isNaN(num)) return;
      acc.sum += num;
      acc.numericCount += 1;
    };
    const valueOf = (acc: Acc): number => {
      if (agg === 'count') return acc.rowCount;
      if (acc.numericCount === 0) return 0;
      return agg === 'avg' ? Math.round((acc.sum / acc.numericCount) * 100) / 100 : acc.sum;
    };

    const totalA = newAcc();
    const totalB = newAcc();
    const groupsA = new Map<string, Acc>();
    const groupsB = new Map<string, Acc>();
    let unparseableDates = 0;

    for (const row of result.rows) {
      const date = parseTolerantDate(row[dateIdx]?.value);
      if (!date) {
        unparseableDates += 1;
        continue;
      }
      const t = date.getTime();
      let period: 'A' | 'B' | null = null;
      if (t >= fromA.getTime() && t < toA.getTime()) period = 'A';
      else if (t >= fromB.getTime() && t < toB.getTime()) period = 'B';
      if (!period) continue;

      const raw = row[measureIdx]?.value;
      addTo(period === 'A' ? totalA : totalB, raw);

      if (groupIdx !== -1) {
        const key = row[groupIdx]?.formattedValue ?? '';
        const groups = period === 'A' ? groupsA : groupsB;
        let acc = groups.get(key);
        if (!acc) {
          acc = newAcc();
          groups.set(key, acc);
        }
        addTo(acc, raw);
      }
    }

    if (totalA.rowCount === 0 && totalB.rowCount === 0) {
      return `Keine Zeilen in Periode A (${args.periodA.from} bis ${args.periodA.to}) oder Periode B (${args.periodB.from} bis ${args.periodB.to}) gefunden — prüfe Datumsspalte "${args.dateColumn}" und die Zeiträume.`;
    }

    const valueA = valueOf(totalA);
    const valueB = valueOf(totalB);
    const diff = valueB - valueA;
    const pctText =
      valueA !== 0 ? `${((diff / Math.abs(valueA)) * 100).toFixed(1)} %` : valueB !== 0 ? 'n/a (Periode A = 0)' : '0.0 %';

    const label = `${agg}(${args.measure})`;
    const parts = [
      `**Periode A** (${args.periodA.from} bis ${args.periodA.to}, exklusiv): ${label} = ${valueA}`,
      `**Periode B** (${args.periodB.from} bis ${args.periodB.to}, exklusiv): ${label} = ${valueB}`,
      `**Differenz**: ${diff} (${pctText})`,
    ];

    if (groupIdx !== -1) {
      const keys = new Set([...groupsA.keys(), ...groupsB.keys()]);
      const groupRows = [...keys]
        .map((key) => {
          const a = valueOf(groupsA.get(key) ?? newAcc());
          const b = valueOf(groupsB.get(key) ?? newAcc());
          return { key, a, b, d: b - a };
        })
        .sort((x, y) => Math.abs(y.d) - Math.abs(x.d));
      const shown = groupRows.slice(0, COMPARE_PERIODS_MAX_GROUPS);
      parts.push('');
      parts.push(
        rowsToMarkdownTable(
          [args.groupBy!, 'A', 'B', 'Differenz'],
          shown.map((r) => [r.key, String(r.a), String(r.b), String(r.d)]),
        ),
      );
      if (groupRows.length > shown.length) {
        parts.push(`Zeige ${shown.length} von ${groupRows.length} Gruppen.`);
      }
    }

    parts.push('_Perioden sind halboffen: from <= Datum < to._');
    if (unparseableDates > 0) {
      parts.push(`${unparseableDates} Zeile(n) mit nicht interpretierbarem Datum in "${args.dateColumn}" wurden ignoriert.`);
    }
    if (result.truncated) {
      parts.push(
        `Achtung: Es wurden nur die ersten ${MAX_AGGREGATE_SOURCE_ROWS} Quellzeilen berücksichtigt — der Datensatz ist größer, der Vergleich ist ggf. unvollständig.`,
      );
    }
    return parts.join('\n');
  },
};
