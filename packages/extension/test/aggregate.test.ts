import type { ToolCall } from '@openvizpilot/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { createMockTableau } from '../src/mock/tableau-mock';
import type { Dashboard } from '../src/tableau/api';
import { readAllSummaryPages } from '../src/tools/executors/helpers';
import { executeToolCall } from '../src/tools/registry';

function call(name: string, args: unknown = {}): ToolCall {
  return { id: 'call_test', type: 'function', function: { name, arguments: JSON.stringify(args) } };
}

let dashboard: Dashboard;
let state: ReturnType<typeof createMockTableau>['state'];

beforeEach(() => {
  const mock = createMockTableau();
  state = mock.state;
  const db = mock.api.extensions.dashboardContent?.dashboard;
  if (!db) throw new Error('mock ohne dashboard');
  dashboard = db;
});

describe('aggregate_summary_data', () => {
  it('computes sum per group, sorted descending by the first measure, and releases the reader', async () => {
    const result = await executeToolCall(
      call('aggregate_summary_data', {
        worksheet: 'Auftragsdetails',
        groupBy: ['Region'],
        measures: [{ column: 'SUM(Umsatz)', agg: 'sum' }],
      }),
      dashboard,
    );
    expect(result).toContain('sum(SUM(Umsatz))');
    // Regionssummen: Nord 600, Süd 1500, Ost 2400, West 3300.
    expect(result).toContain('600');
    expect(result).toContain('1500');
    expect(result).toContain('2400');
    expect(result).toContain('3300');
    // Sortierung: erstes Measure absteigend -> West (3300) vor Nord (600).
    expect(result.indexOf('West')).toBeLessThan(result.indexOf('Nord'));
    expect(result).toContain('4 Gruppen aus 12 Zeilen');
    expect(state.openReaders['Auftragsdetails']).toBe(0);
  });

  it('computes avg, min and count per group', async () => {
    const result = await executeToolCall(
      call('aggregate_summary_data', {
        worksheet: 'Auftragsdetails',
        groupBy: ['Region'],
        measures: [
          { column: 'SUM(Umsatz)', agg: 'avg' },
          { column: 'SUM(Umsatz)', agg: 'min' },
          { column: 'SUM(Umsatz)', agg: 'count' },
        ],
      }),
      dashboard,
    );
    expect(result).toContain('avg(SUM(Umsatz))');
    expect(result).toContain('min(SUM(Umsatz))');
    expect(result).toContain('count(SUM(Umsatz))');
    const nordLine = result.split('\n').find((l) => l.includes('Nord'));
    expect(nordLine).toBeDefined();
    // Nord: Werte 100/200/300 -> avg 200, min 100, count 3.
    expect(nordLine).toContain('| Nord | 200 | 100 | 3 |');
    expect(state.openReaders['Auftragsdetails']).toBe(0);
  });

  it('supports multi-column group-by (Region + Produkt)', async () => {
    const result = await executeToolCall(
      call('aggregate_summary_data', {
        worksheet: 'Auftragsdetails',
        groupBy: ['Region', 'Produkt'],
        measures: [{ column: 'SUM(Umsatz)', agg: 'sum' }],
      }),
      dashboard,
    );
    // 12 einzigartige Region+Produkt-Kombinationen -> eine Gruppe pro Zeile.
    expect(result).toContain('12 Gruppen aus 12 Zeilen');
    const westCLine = result.split('\n').find((l) => l.includes('West') && l.includes('Produkt C'));
    expect(westCLine).toBeDefined();
    expect(westCLine).toContain('1200');
  });

  it('reads the same totals via readAllSummaryPages regardless of page size (paging correctness)', async () => {
    const ws = dashboard.worksheets.find((w) => w.name === 'Auftragsdetails');
    if (!ws) throw new Error('Worksheet "Auftragsdetails" nicht im Mock gefunden');

    const paged = await readAllSummaryPages(ws, 2);
    const bulk = await readAllSummaryPages(ws);

    expect(paged.rows.length).toBe(12);
    expect(bulk.rows.length).toBe(12);
    expect(paged.truncated).toBe(false);
    expect(bulk.truncated).toBe(false);

    const sumOf = (r: typeof paged): number =>
      r.rows.reduce((acc, row) => acc + (row[2]?.value as number), 0);
    expect(sumOf(paged)).toBe(7800);
    expect(sumOf(paged)).toBe(sumOf(bulk));

    expect(state.openReaders['Auftragsdetails']).toBe(0);
  });

  it('returns a self-correcting error for an unknown column and leaks no open reader', async () => {
    const result = await executeToolCall(
      call('aggregate_summary_data', {
        worksheet: 'Auftragsdetails',
        groupBy: ['GibtEsNicht'],
        measures: [{ column: 'SUM(Umsatz)', agg: 'sum' }],
      }),
      dashboard,
    );
    expect(result).toContain('GibtEsNicht');
    expect(result).toContain('nicht gefunden');
    // verfügbare Spalten im Fehlertext
    expect(result).toContain('Region');
    expect(result).toContain('Produkt');
    expect(state.openReaders['Auftragsdetails']).toBe(0);
  });

  it('caps the returned groups via maxRows and notes the truncation in the footer', async () => {
    const result = await executeToolCall(
      call('aggregate_summary_data', {
        worksheet: 'Auftragsdetails',
        groupBy: ['Region', 'Produkt'],
        measures: [{ column: 'SUM(Umsatz)', agg: 'sum' }],
        maxRows: 5,
      }),
      dashboard,
    );
    expect(result).toContain('Zeige 5 von 12 Gruppen');
    expect(state.openReaders['Auftragsdetails']).toBe(0);
  });

  it('skips NULL cells instead of counting them as 0 (sum/avg/min), count still counts the row', async () => {
    // Inline-Fake statt Mock: eine Gruppe mit den Werten 100, 300 und NULL.
    const dv = (value: unknown) => ({ value, formattedValue: value == null ? '' : String(value) });
    const rows = [
      [dv('Nord'), dv(100)],
      [dv('Nord'), dv(300)],
      [dv('Nord'), dv(null)],
    ];
    const fakeDashboard = {
      name: 'Fake',
      worksheets: [
        {
          name: 'W',
          async getSummaryDataReaderAsync() {
            return {
              pageCount: 1,
              totalRowCount: rows.length,
              async getPageAsync() {
                return {
                  columns: [
                    { fieldName: 'Region', dataType: 'string', index: 0 },
                    { fieldName: 'Umsatz', dataType: 'float', index: 1 },
                  ],
                  data: rows,
                };
              },
              async releaseAsync() {},
            };
          },
          async getFiltersAsync() {
            return [];
          },
          async getSelectedMarksAsync() {
            return { data: [] };
          },
          async getDataSourcesAsync() {
            return [];
          },
          addEventListener: () => () => {},
        },
      ],
      async getParametersAsync() {
        return [];
      },
    } as unknown as Dashboard;

    const result = await executeToolCall(
      call('aggregate_summary_data', {
        worksheet: 'W',
        groupBy: ['Region'],
        measures: [
          { column: 'Umsatz', agg: 'sum' },
          { column: 'Umsatz', agg: 'avg' },
          { column: 'Umsatz', agg: 'min' },
          { column: 'Umsatz', agg: 'count' },
        ],
      }),
      fakeDashboard,
    );
    // NULL fließt nicht als 0 ein: sum 400 (nicht 400+0), avg 200 (nicht 133.33), min 100 (nicht 0).
    expect(result).toContain('| Nord | 400 | 200 | 100 | 3 |');
  });
});
