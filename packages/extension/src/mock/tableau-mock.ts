import type {
  DataTable,
  DataTableReader,
  DataValue,
  Filter,
  MarksCollection,
  Parameter,
  TableauApi,
  Unregister,
  Worksheet,
} from '../tableau/api';
import { EVENT_TYPES } from '../tableau/api';

/**
 * Fake-Dashboard für Browser-Entwicklung ohne Tableau (npm run dev:mock) und
 * für Unit-Tests der Executoren. Implementiert exakt die von der Fassade
 * (tableau/api.ts) genutzte API-Teilmenge.
 */

function dv(value: unknown, formatted?: string): DataValue {
  return { value, formattedValue: formatted ?? String(value) };
}

export interface MockState {
  /** Anzahl releaseAsync-Aufrufe pro Worksheet (für Leak-Tests). */
  releases: Record<string, number>;
  /** Anzahl offener (nicht released) Reader pro Worksheet. */
  openReaders: Record<string, number>;
  /** Zuletzt übergebene Reader-Optionen pro Worksheet (für Tests). */
  readerOptions: Record<string, { ignoreSelection?: boolean } | undefined>;
  /** Protokoll ausgeführter Schreibaktionen (für Tests). */
  actions: string[];
  /** Event manuell auslösen (Demo/Tests). */
  emit(eventType: string): void;
}

interface MockWorksheetSpec {
  name: string;
  columns: Array<{ fieldName: string; dataType: string }>;
  rows: unknown[][];
  filters: Filter[];
  selectedRows?: number[];
  datasource: { name: string; fields: Array<{ name: string; role: string; aggregation?: string }> };
}

const WORKSHEETS: MockWorksheetSpec[] = [
  {
    name: 'Umsatz nach Region',
    columns: [
      { fieldName: 'Region', dataType: 'string' },
      { fieldName: 'SUM(Umsatz)', dataType: 'float' },
      { fieldName: 'CNT(Aufträge)', dataType: 'int' },
    ],
    rows: [
      ['Nord', 125_000.5, 320],
      ['Süd', 98_400.0, 260],
      ['Ost', 74_200.25, 190],
      ['West', 143_900.75, 410],
    ],
    filters: [
      {
        fieldName: 'Region',
        filterType: 'categorical',
        isAllSelected: true,
        appliedValues: [],
        isExcludeMode: false,
      },
      {
        fieldName: 'Bestelldatum',
        filterType: 'relative-date',
        rangeType: 'lastn',
        rangeN: 12,
        periodType: 'month',
      },
    ],
    selectedRows: [0],
    datasource: {
      name: 'Vertrieb (Beispiel)',
      fields: [
        { name: 'Region', role: 'dimension' },
        { name: 'Umsatz', role: 'measure', aggregation: 'SUM' },
        { name: 'Aufträge', role: 'measure', aggregation: 'CNT' },
        { name: 'Vertriebspartner', role: 'dimension' },
      ],
    },
  },
  {
    name: 'Top Produkte',
    columns: [
      { fieldName: 'Produkt', dataType: 'string' },
      { fieldName: 'Kategorie', dataType: 'string' },
      { fieldName: 'SUM(Umsatz)', dataType: 'float' },
    ],
    rows: [
      ['Alpha-Serie', 'Maschinen', 88_000],
      ['Beta | Spezial', 'Ersatzteile', 45_500],
      ['Gamma 2000', 'Maschinen', 39_900],
      ['Delta-Paket', 'Service', 21_000],
      ['Epsilon-Kit', 'Ersatzteile', 18_750],
    ],
    filters: [
      {
        fieldName: 'Kategorie',
        filterType: 'categorical',
        appliedValues: [dv('Maschinen'), dv('Ersatzteile'), dv('Service')],
        isExcludeMode: false,
      },
    ],
    datasource: {
      name: 'Vertrieb (Beispiel)',
      fields: [
        { name: 'Produkt', role: 'dimension' },
        { name: 'Kategorie', role: 'dimension' },
        { name: 'Umsatz', role: 'measure', aggregation: 'SUM' },
      ],
    },
  },
  {
    name: 'Auftragsdetails',
    columns: [
      { fieldName: 'Region', dataType: 'string' },
      { fieldName: 'Produkt', dataType: 'string' },
      { fieldName: 'SUM(Umsatz)', dataType: 'float' },
    ],
    // 4 Regionen × 3 Produkte, im Kopf nachrechenbar: Umsatz steigt in 100er-Schritten
    // (Nord=100..300, Süd=400..600, Ost=700..900, West=1000..1200). Regionssummen:
    // Nord 600, Süd 1500, Ost 2400, West 3300 (Gesamt 7800).
    rows: [
      ['Nord', 'Produkt A', 100],
      ['Nord', 'Produkt B', 200],
      ['Nord', 'Produkt C', 300],
      ['Süd', 'Produkt A', 400],
      ['Süd', 'Produkt B', 500],
      ['Süd', 'Produkt C', 600],
      ['Ost', 'Produkt A', 700],
      ['Ost', 'Produkt B', 800],
      ['Ost', 'Produkt C', 900],
      ['West', 'Produkt A', 1000],
      ['West', 'Produkt B', 1100],
      ['West', 'Produkt C', 1200],
    ],
    filters: [],
    datasource: {
      name: 'Vertrieb (Beispiel)',
      fields: [
        { name: 'Region', role: 'dimension' },
        { name: 'Produkt', role: 'dimension' },
        { name: 'Umsatz', role: 'measure', aggregation: 'SUM' },
      ],
    },
  },
];

const PARAMETERS: Parameter[] = [
  {
    name: 'Zeitraum',
    currentValue: dv('Letzte 12 Monate'),
    dataType: 'string',
    allowableValues: {
      type: 'list',
      allowableValues: [dv('Letzte 12 Monate'), dv('Aktuelles Jahr'), dv('Vorjahr')],
    },
  },
  {
    name: 'Zielmarge',
    currentValue: dv(0.15, '15 %'),
    dataType: 'float',
    allowableValues: { type: 'range', minValue: dv(0, '0 %'), maxValue: dv(1, '100 %') },
  },
];

export function createMockTableau(): { api: TableauApi; state: MockState } {
  const listeners = new Map<string, Set<() => void>>();
  const releases: Record<string, number> = {};
  const openReaders: Record<string, number> = {};
  const readerOptions: Record<string, { ignoreSelection?: boolean } | undefined> = {};
  const actions: string[] = [];

  // Instanz-Kopien, damit Schreibaktionen (Filter/Parameter) nicht zwischen
  // Mock-Instanzen bzw. Tests leaken.
  const worksheetSpecs = WORKSHEETS.map((s) => ({
    ...s,
    filters: s.filters.map((f) => ({
      ...f,
      appliedValues: f.appliedValues ? [...f.appliedValues] : undefined,
    })),
  }));
  const parameters: Parameter[] = PARAMETERS.map((p) => ({
    ...p,
    currentValue: { ...p.currentValue },
  }));

  const addListener = (eventType: string, handler: (event: unknown) => void): Unregister => {
    let set = listeners.get(eventType);
    if (!set) {
      set = new Set();
      listeners.set(eventType, set);
    }
    const h = () => handler({});
    set.add(h);
    return () => set?.delete(h);
  };

  const makeTable = (spec: MockWorksheetSpec, rowIndices?: number[]): DataTable => {
    const rows = rowIndices ? rowIndices.map((i) => spec.rows[i] ?? []) : spec.rows;
    return {
      columns: spec.columns.map((c, index) => ({ ...c, index })),
      data: rows.map((row) => row.map((cell) => dv(cell))),
      totalRowCount: rows.length,
      isTotalRowCountLimited: false,
    };
  };

  const makeWorksheet = (spec: MockWorksheetSpec): Worksheet => ({
    name: spec.name,
    async getSummaryDataReaderAsync(
      pageRowCount?: number,
      options?: { ignoreSelection?: boolean },
    ): Promise<DataTableReader> {
      // Wie die echte API: nur ein aktiver Reader pro Worksheet.
      if ((openReaders[spec.name] ?? 0) > 0) {
        throw new Error(
          `Für "${spec.name}" ist bereits ein DataTableReader aktiv — erst releaseAsync() aufrufen.`,
        );
      }
      const pageSize = pageRowCount ?? 10_000;
      openReaders[spec.name] = (openReaders[spec.name] ?? 0) + 1;
      readerOptions[spec.name] = options;
      let released = false;
      return {
        pageCount: Math.max(1, Math.ceil(spec.rows.length / pageSize)),
        totalRowCount: spec.rows.length,
        async getPageAsync(pageNumber: number): Promise<DataTable> {
          if (released) throw new Error('Reader wurde bereits freigegeben');
          const start = pageNumber * pageSize;
          const indices = spec.rows.map((_, i) => i).slice(start, start + pageSize);
          return makeTable(spec, indices);
        },
        async releaseAsync(): Promise<void> {
          if (!released) {
            released = true;
            releases[spec.name] = (releases[spec.name] ?? 0) + 1;
            openReaders[spec.name] = (openReaders[spec.name] ?? 1) - 1;
          }
        },
      };
    },
    async getFiltersAsync(): Promise<Filter[]> {
      return spec.filters;
    },
    async getSelectedMarksAsync(): Promise<MarksCollection> {
      return { data: [makeTable(spec, spec.selectedRows ?? [])] };
    },
    async getDataSourcesAsync() {
      return [
        {
          name: spec.datasource.name,
          fields: spec.datasource.fields,
        },
      ];
    },
    addEventListener: addListener,
    async applyFilterAsync(fieldName, values, _updateType, options) {
      const existing = spec.filters.find(
        (f) => f.fieldName === fieldName && f.filterType === 'categorical',
      );
      const applied = values.map((v) => dv(v));
      if (existing) {
        existing.appliedValues = applied;
        existing.isAllSelected = false;
        existing.isExcludeMode = options?.isExcludeMode ?? false;
      } else {
        spec.filters.push({
          fieldName,
          filterType: 'categorical',
          appliedValues: applied,
          isExcludeMode: options?.isExcludeMode ?? false,
        });
      }
      actions.push(`apply_filter:${spec.name}:${fieldName}=${values.join('|')}`);
      for (const h of listeners.get(EVENT_TYPES.FilterChanged) ?? []) h();
      return fieldName;
    },
    async clearFilterAsync(fieldName) {
      const idx = spec.filters.findIndex((f) => f.fieldName === fieldName);
      if (idx >= 0) spec.filters.splice(idx, 1);
      actions.push(`clear_filter:${spec.name}:${fieldName}`);
      for (const h of listeners.get(EVENT_TYPES.FilterChanged) ?? []) h();
      return fieldName;
    },
    async selectMarksByValueAsync(criteria, updateType) {
      const desc = criteria.map((c) => `${c.fieldName}=${c.value.join('|')}`).join(';');
      actions.push(`select_marks:${spec.name}:${desc}:${updateType}`);
      for (const h of listeners.get(EVENT_TYPES.MarkSelectionChanged) ?? []) h();
    },
  });

  const settingsStore = new Map<string, string>(loadLocalSettings());

  const api: TableauApi = {
    TableauEventType: { ...EVENT_TYPES },
    SelectionUpdateType: { Replace: 'select-replace', Add: 'select-add', Remove: 'select-remove' },
    extensions: {
      async initializeAsync() {
        /* sofort bereit */
      },
      workbook: {
        async activateSheetAsync(sheetName: string) {
          const known = ['Vertriebsübersicht (Mock)', ...worksheetSpecs.map((w) => w.name)];
          if (!known.includes(sheetName)) {
            throw new Error(`Sheet "${sheetName}" nicht gefunden. Verfügbar: ${known.map((n) => `"${n}"`).join(', ')}`);
          }
          actions.push(`activate_sheet:${sheetName}`);
        },
      },
      dashboardContent: {
        dashboard: {
          name: 'Vertriebsübersicht (Mock)',
          worksheets: worksheetSpecs.map(makeWorksheet),
          async getParametersAsync() {
            return parameters.map((p) => ({
              ...p,
              addEventListener: addListener,
              async changeValueAsync(newValue: string | number | boolean | Date) {
                p.currentValue = dv(newValue);
                actions.push(`set_parameter:${p.name}=${String(newValue)}`);
                for (const h of listeners.get(EVENT_TYPES.ParameterChanged) ?? []) h();
                return p.currentValue;
              },
            }));
          },
        },
      },
      settings: {
        get: (key) => settingsStore.get(key),
        set: (key, value) => {
          settingsStore.set(key, value);
        },
        async saveAsync() {
          persistLocalSettings(settingsStore);
          return undefined;
        },
      },
      environment: { mode: 'authoring', context: 'mock', apiVersion: 'mock', uniqueUserId: 'mock-user-1' },
    },
  };

  const state: MockState = {
    releases,
    openReaders,
    readerOptions,
    actions,
    emit(eventType: string) {
      for (const h of listeners.get(eventType) ?? []) h();
    },
  };

  return { api, state };
}

export function installMockTableau(): MockState {
  const { api, state } = createMockTableau();
  (globalThis as Record<string, unknown>).tableau = api;
  (globalThis as Record<string, unknown>).__tableauMockState = state;
  return state;
}

function loadLocalSettings(): Array<[string, string]> {
  try {
    const raw = localStorage.getItem('tableauChat.mockSettings');
    return raw ? (JSON.parse(raw) as Array<[string, string]>) : [];
  } catch {
    return [];
  }
}

function persistLocalSettings(store: Map<string, string>): void {
  try {
    localStorage.setItem('tableauChat.mockSettings', JSON.stringify([...store.entries()]));
  } catch {
    // localStorage nicht verfügbar — Settings gelten nur für die Sitzung.
  }
}
