/**
 * Typisierte Fassade über die von uns genutzte Teilmenge der Tableau
 * Extensions API (Laufzeit: tableau.extensions.1.latest.js, global `tableau`).
 *
 * Bewusst eigene, strukturelle Typen statt @tableau/extensions-api-types:
 * der Mock (mock/tableau-mock.ts) implementiert exakt dieses Interface, und
 * die Fassade bleibt unabhängig von Versionssprüngen des Typpakets.
 */

export type TableauDataType = 'string' | 'int' | 'float' | 'bool' | 'date' | 'date-time' | 'spatial';

export interface DataValue {
  value: unknown;
  formattedValue: string;
}

export interface Column {
  fieldName: string;
  dataType: TableauDataType | string;
  index: number;
}

export interface DataTable {
  columns: Column[];
  data: DataValue[][];
  totalRowCount?: number;
  isTotalRowCountLimited?: boolean;
  name?: string;
}

export interface DataTableReader {
  pageCount: number;
  totalRowCount: number;
  getPageAsync(pageNumber: number): Promise<DataTable>;
  releaseAsync(): Promise<void>;
}

export interface Filter {
  fieldName: string;
  /** 'categorical' | 'range' | 'relative-date' | 'hierarchical' */
  filterType: string;
  worksheetName?: string;
  appliedValues?: DataValue[];
  isExcludeMode?: boolean;
  isAllSelected?: boolean;
  minValue?: DataValue;
  maxValue?: DataValue;
  includeNullValues?: boolean;
  periodType?: string;
  rangeType?: string;
  rangeN?: number;
}

export interface ParameterAllowableValues {
  type: string; // 'all' | 'list' | 'range'
  allowableValues?: DataValue[];
  minValue?: DataValue;
  maxValue?: DataValue;
}

export type Unregister = () => void;

export interface Parameter {
  name: string;
  currentValue: DataValue;
  dataType: string;
  allowableValues?: ParameterAllowableValues;
  addEventListener?(eventType: string, handler: (event: unknown) => void): Unregister;
  /** Schreibend — wird NUR nach explizitem User-Klick aufgerufen (Action-Chips). */
  changeValueAsync?(newValue: string | number | boolean | Date): Promise<DataValue>;
}

export interface MarksCollection {
  data: DataTable[];
}

export interface DataSourceField {
  name: string;
  role?: string; // 'dimension' | 'measure' | 'unknown'
  aggregation?: string;
  isCalculatedField?: boolean;
  isHidden?: boolean;
}

export interface DataSource {
  name: string;
  id?: string;
  fields: DataSourceField[];
}

export interface Worksheet {
  name: string;
  getSummaryDataReaderAsync(
    pageRowCount?: number,
    options?: { ignoreSelection?: boolean },
  ): Promise<DataTableReader>;
  getFiltersAsync(): Promise<Filter[]>;
  getSelectedMarksAsync(): Promise<MarksCollection>;
  getDataSourcesAsync(): Promise<DataSource[]>;
  addEventListener(eventType: string, handler: (event: unknown) => void): Unregister;
  /** Schreibend — werden NUR nach explizitem User-Klick aufgerufen (Action-Chips). */
  applyFilterAsync?(
    fieldName: string,
    values: string[],
    updateType: string,
    options?: { isExcludeMode?: boolean },
  ): Promise<string>;
  clearFilterAsync?(fieldName: string): Promise<string>;
  /** Schreibend (Auswahl im Dashboard) — NUR nach explizitem User-Klick (Action-Chips). */
  selectMarksByValueAsync?(
    criteria: Array<{ fieldName: string; value: string[] }>,
    updateType: string,
  ): Promise<void>;
}

export interface Dashboard {
  name: string;
  worksheets: Worksheet[];
  getParametersAsync(): Promise<Parameter[]>;
}

export interface Settings {
  get(key: string): string | undefined;
  set(key: string, value: string): void;
  saveAsync(): Promise<unknown>;
}

export interface Environment {
  mode?: string;
  context?: string;
  apiVersion?: string;
  tableauVersion?: string;
  /** Obfuskierte, stabile ID des eingeloggten Users (Extensions API >= 1.11). */
  uniqueUserId?: string;
}

export interface Workbook {
  /**
   * Aktiviert ein Sheet (Worksheet oder Dashboard) des Workbooks — Laufzeit
   * ab Extensions API 1.11; die Typdefinitionen 1.17 kennen es (noch) nicht,
   * deshalb optional und zur Laufzeit geprüft. NUR nach User-Klick.
   */
  activateSheetAsync?(sheetName: string): Promise<void>;
}

export interface Extensions {
  initializeAsync(config?: { configure?: () => object }): Promise<void>;
  dashboardContent?: { dashboard: Dashboard };
  workbook?: Workbook;
  settings: Settings;
  environment: Environment;
}

export interface TableauApi {
  extensions: Extensions;
  TableauEventType?: Record<string, string>;
  /** Enum der Laufzeit; Fallback-Werte in SELECTION_UPDATE. */
  SelectionUpdateType?: Record<string, string>;
}

/** Fallback für tableau.SelectionUpdateType (Werte der Extensions API). */
export const SELECTION_UPDATE = { Replace: 'select-replace', Add: 'select-add', Remove: 'select-remove' } as const;

export function selectionUpdateType(name: keyof typeof SELECTION_UPDATE): string {
  const t = (globalThis as Record<string, unknown>).tableau as TableauApi | undefined;
  return t?.SelectionUpdateType?.[name] ?? SELECTION_UPDATE[name];
}

/** Fallback-Konstanten, falls tableau.TableauEventType fehlt (z. B. im Mock). */
export const EVENT_TYPES = {
  FilterChanged: 'filter-changed',
  ParameterChanged: 'parameter-changed',
  MarkSelectionChanged: 'mark-selection-changed',
  SummaryDataChanged: 'summary-data-changed',
} as const;

export function getTableau(): TableauApi {
  const t = (globalThis as Record<string, unknown>).tableau as TableauApi | undefined;
  if (!t || !t.extensions) {
    throw new Error(
      'Tableau Extensions API nicht gefunden. Läuft die Seite außerhalb von Tableau? (Für Browser-Entwicklung: npm run dev:mock)',
    );
  }
  return t;
}

export function eventType(name: keyof typeof EVENT_TYPES): string {
  const t = (globalThis as Record<string, unknown>).tableau as TableauApi | undefined;
  return t?.TableauEventType?.[name] ?? EVENT_TYPES[name];
}
