import type { Column, Dashboard, DataTable, DataTableReader, DataValue, Worksheet } from '../../tableau/api';

/** Findet ein Worksheet oder wirft einen selbstkorrigierenden Fehler mit den verfügbaren Namen. */
export function findWorksheet(dashboard: Dashboard, name: string): Worksheet {
  const ws = dashboard.worksheets.find((w) => w.name === name);
  if (ws) return ws;
  const available = dashboard.worksheets.map((w) => `"${w.name}"`).join(', ');
  throw new Error(`Worksheet "${name}" nicht gefunden. Verfügbare Worksheets: ${available}`);
}

export interface SummaryReadResult {
  headers: string[];
  /** Datentypen, positionsgleich zu headers. */
  columnTypes: string[];
  rows: string[][];
  totalRowCount: number;
  limited: boolean;
  /** Angeforderte, aber nicht vorhandene Spalten (Projektion). */
  missingColumns: string[];
}

/**
 * Liest die ersten maxRows Zeilen der Summary-Daten eines Worksheets.
 * Der Reader wird in JEDEM Pfad über releaseAsync freigegeben.
 */
export async function readSummaryRows(
  worksheet: Worksheet,
  maxRows: number,
  columns?: string[],
): Promise<SummaryReadResult> {
  let reader: DataTableReader | null = null;
  try {
    // ignoreSelection: bei aktiver Mark-Selektion würden die Summary-Daten
    // sonst nur die selektierten Zeilen enthalten (dafür gibt es das
    // separate Tool get_selected_marks).
    reader = await worksheet.getSummaryDataReaderAsync(maxRows, { ignoreSelection: true });
    if (reader.pageCount === 0) {
      return {
        headers: [],
        columnTypes: [],
        rows: [],
        totalRowCount: 0,
        limited: false,
        missingColumns: [],
      };
    }
    const page = await reader.getPageAsync(0);
    const projection = selectColumns(page, columns);
    const rows = page.data
      .slice(0, maxRows)
      .map((row) => projection.indices.map((i) => row[i]?.formattedValue ?? ''));
    return {
      headers: projection.headers,
      columnTypes: projection.types,
      rows,
      totalRowCount: reader.totalRowCount,
      limited: reader.totalRowCount > rows.length,
      missingColumns: projection.missing,
    };
  } finally {
    if (reader) {
      await reader.releaseAsync().catch(() => undefined);
    }
  }
}

function selectColumns(
  page: DataTable,
  columns?: string[],
): { headers: string[]; types: string[]; indices: number[]; missing: string[] } {
  if (!columns || columns.length === 0) {
    return {
      headers: page.columns.map((c) => c.fieldName),
      types: page.columns.map((c) => String(c.dataType)),
      indices: page.columns.map((c) => c.index),
      missing: [],
    };
  }
  const headers: string[] = [];
  const types: string[] = [];
  const indices: number[] = [];
  const missing: string[] = [];
  for (const wanted of columns) {
    const col = page.columns.find((c) => c.fieldName === wanted);
    if (col) {
      headers.push(col.fieldName);
      types.push(String(col.dataType));
      indices.push(col.index);
    } else {
      missing.push(wanted);
    }
  }
  if (headers.length === 0) {
    const available = page.columns.map((c) => `"${c.fieldName}"`).join(', ');
    throw new Error(`Keine der angeforderten Spalten gefunden. Verfügbare Spalten: ${available}`);
  }
  return { headers, types, indices, missing };
}

/** Rendert eine DataTable (z. B. selektierte Marks) als Markdown-Zeilenmaterial. */
export function tableToRows(table: DataTable, maxRows: number): { headers: string[]; rows: string[][] } {
  const headers = table.columns.map((c) => c.fieldName);
  const rows = table.data
    .slice(0, maxRows)
    .map((row) => table.columns.map((c) => row[c.index]?.formattedValue ?? ''));
  return { headers, rows };
}

/** Obergrenze für clientseitig verarbeitete Quellzeilen (Performance-Schutz bei Voll-Scans). */
export const MAX_AGGREGATE_SOURCE_ROWS = 50_000;

export interface AllSummaryPagesResult {
  columns: Column[];
  rows: DataValue[][];
  totalRowCount: number;
  /** true, wenn wegen MAX_AGGREGATE_SOURCE_ROWS nicht alle Quellzeilen gelesen wurden. */
  truncated: boolean;
}

/**
 * Liest ALLE Seiten der Summary-Daten eines Worksheets (nicht nur die erste),
 * damit clientseitige Aggregationen (aggregate_summary_data) über den
 * vollständigen gefilterten Datensatz laufen statt nur über eine Seite.
 * Der Reader wird in JEDEM Pfad über releaseAsync freigegeben.
 */
export async function readAllSummaryPages(
  worksheet: Worksheet,
  pageRowCount = 4000,
): Promise<AllSummaryPagesResult> {
  let reader: DataTableReader | null = null;
  try {
    // ignoreSelection: siehe readSummaryRows — Aggregationen sollen über die
    // volle (gefilterte) Summary-Ansicht laufen, nicht nur die Selektion.
    reader = await worksheet.getSummaryDataReaderAsync(pageRowCount, { ignoreSelection: true });
    if (reader.pageCount === 0) {
      return { columns: [], rows: [], totalRowCount: 0, truncated: false };
    }
    let columns: Column[] = [];
    const rows: DataValue[][] = [];
    let truncated = false;
    for (let i = 0; i < reader.pageCount; i++) {
      const page = await reader.getPageAsync(i);
      if (columns.length === 0) columns = page.columns;
      for (const row of page.data) {
        if (rows.length >= MAX_AGGREGATE_SOURCE_ROWS) {
          truncated = true;
          break;
        }
        rows.push(row);
      }
      if (truncated) break;
    }
    return { columns, rows, totalRowCount: reader.totalRowCount, truncated };
  } finally {
    if (reader) {
      await reader.releaseAsync().catch(() => undefined);
    }
  }
}
