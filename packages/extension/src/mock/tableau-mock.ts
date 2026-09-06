import type {
  DashboardObject,
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
  /** Feuert ein Ereignis — ohne `scope` überall, mit `scope` nur in diesem Worksheet. */
  emit(eventType: string, scope?: string): void;
}

interface MockWorksheetSpec {
  name: string;
  columns: Array<{ fieldName: string; dataType: string }>;
  rows: unknown[][];
  filters: Filter[];
  selectedRows?: number[];
  /** Marks, die hervorgehoben (nicht selektiert) sind — Highlighter/Legende. */
  highlightedRows?: number[];
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
    // Nichts selektiert, aber zwei Zeilen hervorgehoben — so lässt sich der
    // Unterschied zwischen Selektion und Highlight ohne Tableau durchspielen.
    highlightedRows: [0, 1],
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
  // Ein Topf JE BEREICH: Ein Ereignis in „Top Produkte" darf nicht die Handler
  // von „Umsatz nach Region" auslösen — sonst nennt die Extension im Mock das
  // falsche Worksheet, und genau das soll der Mock ja aufdecken.
  const listeners = new Map<string, Map<string, Set<(event: unknown) => void>>>();
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

  const listenersIn = (scope: string, eventType: string): Set<(event: unknown) => void> => {
    let byType = listeners.get(scope);
    if (!byType) {
      byType = new Map();
      listeners.set(scope, byType);
    }
    let set = byType.get(eventType);
    if (!set) {
      set = new Set();
      byType.set(eventType, set);
    }
    return set;
  };

  const addListenerIn =
    (scope: string) =>
    (eventType: string, handler: (event: unknown) => void): Unregister => {
      const set = listenersIn(scope, eventType);
      set.add(handler);
      return () => set.delete(handler);
    };

  const addListener = addListenerIn('dashboard');

  const emitIn = (scope: string, eventType: string, event: unknown) => {
    for (const h of [...listenersIn(scope, eventType)]) h(event);
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
    async getHighlightedMarksAsync(): Promise<MarksCollection> {
      return { data: [makeTable(spec, spec.highlightedRows ?? [])] };
    },
    async getDataSourcesAsync() {
      return [
        {
          name: spec.datasource.name,
          fields: spec.datasource.fields,
          async getConnectionSummariesAsync() {
            return [{ name: spec.datasource.name, id: 'mock-connection', type: 'hyper' }];
          },
        },
      ];
    },
    addEventListener: addListenerIn(spec.name),
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
      emitIn(spec.name, EVENT_TYPES.FilterChanged, { worksheet: { name: spec.name }, fieldName });
      return fieldName;
    },
    async clearFilterAsync(fieldName) {
      const idx = spec.filters.findIndex((f) => f.fieldName === fieldName);
      if (idx >= 0) spec.filters.splice(idx, 1);
      actions.push(`clear_filter:${spec.name}:${fieldName}`);
      emitIn(spec.name, EVENT_TYPES.FilterChanged, { worksheet: { name: spec.name }, fieldName });
      return fieldName;
    },
    async selectMarksByValueAsync(criteria, updateType) {
      const desc = criteria.map((c) => `${c.fieldName}=${c.value.join('|')}`).join(';');
      actions.push(`select_marks:${spec.name}:${desc}:${updateType}`);
      emitIn(spec.name, EVENT_TYPES.MarkSelectionChanged, { worksheet: { name: spec.name } });
    },
  });

  const settingsStore = new Map<string, string>(loadLocalSettings());

  // Zonen des Mock-Dashboards: zwei Sichten, ein ausgeblendetes Detailblatt
  // und zwei Bedienelemente — genug, um Sichtbarkeit und „wo stelle ich das
  // um?" ohne Tableau durchzuspielen.
  const zones: DashboardObject[] = [
    { id: 1, name: 'Umsatz nach Region', type: 'worksheet', isVisible: true },
    { id: 2, name: 'Top Produkte', type: 'worksheet', isVisible: true },
    { id: 3, name: 'Auftragsdetails', type: 'worksheet', isVisible: false },
    { id: 4, name: 'Region', type: 'quick-filter', isVisible: true },
    { id: 5, name: 'Mindestumsatz', type: 'parameter-control', isVisible: true },
    { id: 6, name: 'OpenVizPilot', type: 'extension', isVisible: true },
  ];

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
          objects: zones,
          addEventListener: addListener,
          async setZoneVisibilityAsync(map: Record<number, string>) {
            for (const [id, visibility] of Object.entries(map)) {
              const zone = zones.find((z) => z.id === Number(id));
              if (!zone) throw new Error(`Zone ${id} nicht gefunden.`);
              zone.isVisible = visibility === 'show';
              actions.push(`set_zone_visibility:${zone.name}=${visibility}`);
            }
            emitIn('dashboard', EVENT_TYPES.DashboardLayoutChanged, {});
          },
          async getParametersAsync() {
            return parameters.map((p) => ({
              ...p,
              addEventListener: addListenerIn(`parameter:${p.name}`),
              async changeValueAsync(newValue: string | number | boolean | Date) {
                p.currentValue = dv(newValue);
                actions.push(`set_parameter:${p.name}=${String(newValue)}`);
                emitIn(`parameter:${p.name}`, EVENT_TYPES.ParameterChanged, { parameterName: p.name });
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
      environment: {
        mode: 'authoring',
        context: 'mock',
        apiVersion: 'mock',
        uniqueUserId: 'mock-user-1',
        // Wie ein Workbook mit eigener Hausschrift — zeigt im Mock, dass das
        // Panel die Formatierung übernimmt.
        workbookFormatting: {
          formattingSheets: [
            { classNameKey: 'tableau-worksheet', cssProperties: { fontFamily: 'Georgia, serif', fontSize: '13px', color: '#2b2b2b' } },
            { classNameKey: 'tableau-worksheet-title', cssProperties: { fontFamily: 'Georgia, serif', fontWeight: '700' } },
          ],
        },
      },
    },
  };

  const state: MockState = {
    releases,
    openReaders,
    readerOptions,
    actions,
    emit(eventType: string, scope?: string) {
      // Ohne Bereich: alle — wie bisher. Mit Bereich: nur dort, inklusive
      // Herkunftsangabe, wie sie die echte API im Event mitliefert.
      for (const [name, byType] of listeners) {
        if (scope && name !== scope) continue;
        const event = name === 'dashboard' || name.startsWith('parameter:') ? {} : { worksheet: { name } };
        for (const h of [...(byType.get(eventType) ?? [])]) h(event);
      }
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
