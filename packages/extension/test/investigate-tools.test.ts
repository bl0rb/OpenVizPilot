import type { ToolCall } from '@openvizpilot/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { createMockTableau } from '../src/mock/tableau-mock';
import type { Dashboard } from '../src/tableau/api';
import { executeToolCall } from '../src/tools/registry';

/**
 * Untersuchungsmodus (W3): breakdown_by und compare_periods gegen den Mock.
 * "Auftragsdetails" (12 Zeilen, siehe tableau-mock.ts): Region × Produkt,
 * Umsatz in 100er-Schritten; Regionssummen Nord 600, Süd 1500, Ost 2400,
 * West 3300 (Gesamt 7800). Bestelldatum: Produkt A/B im Januar/Februar 2024,
 * Produkt C im März 2024 — Grundlage für die compare_periods-Tests unten.
 */

function call(name: string, args: unknown = {}): ToolCall {
  return { id: 'call_test', type: 'function', function: { name, arguments: JSON.stringify(args) } };
}

let dashboard: Dashboard;

beforeEach(() => {
  const mock = createMockTableau();
  const db = mock.api.extensions.dashboardContent?.dashboard;
  if (!db) throw new Error('mock ohne dashboard');
  dashboard = db;
});

describe('breakdown_by', () => {
  it('groups by dimension, sums by default, sorts descending and reports shares + top-3', async () => {
    const result = await executeToolCall(
      call('breakdown_by', { worksheet: 'Auftragsdetails', dimension: 'Region', measure: 'SUM(Umsatz)' }),
      dashboard,
    );
    expect(result).toContain('sum(SUM(Umsatz))');
    expect(result).toContain('4 Gruppen aus 12 Zeilen');
    // Sortierung: West (3300) vor Nord (600).
    expect(result.indexOf('West')).toBeLessThan(result.indexOf('Nord'));
    // Anteile (Gesamt 7800): West 42.3 %, Ost 30.8 %, Süd 19.2 %, Nord 7.7 %.
    expect(result).toContain('| West | 3300 | 42.3 % |');
    expect(result).toContain('| Ost | 2400 | 30.8 % |');
    expect(result).toContain('| Süd | 1500 | 19.2 % |');
    expect(result).toContain('| Nord | 600 | 7.7 % |');
    // Top-3 (West+Ost+Süd = 7200) von 7800 = 92.3 %.
    expect(result).toContain('Top-3 erklären 92.3 % des Gesamtwerts.');
  });

  it('collapses groups beyond maxGroups into "Übrige (N)"', async () => {
    const result = await executeToolCall(
      call('breakdown_by', {
        worksheet: 'Auftragsdetails',
        dimension: 'Region',
        measure: 'SUM(Umsatz)',
        maxGroups: 2,
      }),
      dashboard,
    );
    expect(result).toContain('| West | 3300 |');
    expect(result).toContain('| Ost | 2400 |');
    // Süd (1500) + Nord (600) = 2100, Anteil 26.9 %.
    expect(result).toContain('| Übrige (2) | 2100 | 26.9 % |');
    expect(result).not.toContain('| Süd |');
    expect(result).not.toContain('| Nord |');
  });

  it('supports avg and count aggregation', async () => {
    const result = await executeToolCall(
      call('breakdown_by', { worksheet: 'Auftragsdetails', dimension: 'Region', measure: 'SUM(Umsatz)', agg: 'count' }),
      dashboard,
    );
    expect(result).toContain('count(SUM(Umsatz))');
    // 4 Regionen × 3 Produkte -> je Region 3 Zeilen.
    expect(result).toContain('| West | 3 |');
    expect(result).toContain('| Nord | 3 |');
  });

  it('returns a self-correcting error for an unknown dimension or measure', async () => {
    const result = await executeToolCall(
      call('breakdown_by', { worksheet: 'Auftragsdetails', dimension: 'GibtEsNicht', measure: 'SUM(Umsatz)' }),
      dashboard,
    );
    expect(result).toContain('GibtEsNicht');
    expect(result).toContain('nicht gefunden');
    expect(result).toContain('Region');
    expect(result).toContain('Bestelldatum');
  });
});

describe('compare_periods', () => {
  it('compares two periods and reports absolute and percentage difference', async () => {
    const result = await executeToolCall(
      call('compare_periods', {
        worksheet: 'Auftragsdetails',
        dateColumn: 'Bestelldatum',
        measure: 'SUM(Umsatz)',
        periodA: { from: '2024-01-01', to: '2024-03-01' },
        periodB: { from: '2024-03-01', to: '2024-04-01' },
      }),
      dashboard,
    );
    // Periode A (Jan+Feb, Produkt A+B): 4800. Periode B (März, Produkt C): 3000.
    expect(result).toContain('= 4800');
    expect(result).toContain('= 3000');
    expect(result).toContain('**Differenz**: -1800 (-37.5 %)');
    expect(result).toContain('halboffen');
  });

  it('breaks the comparison down per group, sorted by absolute difference', async () => {
    const result = await executeToolCall(
      call('compare_periods', {
        worksheet: 'Auftragsdetails',
        dateColumn: 'Bestelldatum',
        measure: 'SUM(Umsatz)',
        periodA: { from: '2024-01-01', to: '2024-03-01' },
        periodB: { from: '2024-03-01', to: '2024-04-01' },
        groupBy: 'Region',
      }),
      dashboard,
    );
    // Je Region: Nord 300->300 (0), Süd 900->600 (-300), Ost 1500->900 (-600), West 2100->1200 (-900).
    expect(result).toContain('| West | 2100 | 1200 | -900 |');
    expect(result).toContain('| Ost | 1500 | 900 | -600 |');
    expect(result).toContain('| Süd | 900 | 600 | -300 |');
    expect(result).toContain('| Nord | 300 | 300 | 0 |');
    // Sortiert nach |Differenz| absteigend: West vor Nord.
    expect(result.indexOf('West')).toBeLessThan(result.indexOf('Nord'));
  });

  it('returns a self-correcting error for an unknown date/measure/groupBy column', async () => {
    const result = await executeToolCall(
      call('compare_periods', {
        worksheet: 'Auftragsdetails',
        dateColumn: 'GibtEsNicht',
        measure: 'SUM(Umsatz)',
        periodA: { from: '2024-01-01', to: '2024-02-01' },
        periodB: { from: '2024-02-01', to: '2024-03-01' },
      }),
      dashboard,
    );
    expect(result).toContain('GibtEsNicht');
    expect(result).toContain('nicht gefunden');
    expect(result).toContain('Bestelldatum');
  });

  it('rejects an unparseable period boundary', async () => {
    const result = await executeToolCall(
      call('compare_periods', {
        worksheet: 'Auftragsdetails',
        dateColumn: 'Bestelldatum',
        measure: 'SUM(Umsatz)',
        periodA: { from: 'nicht-ein-datum', to: '2024-02-01' },
        periodB: { from: '2024-02-01', to: '2024-03-01' },
      }),
      dashboard,
    );
    expect(result).toContain('Ungültiges Datum');
  });

  it('applies half-open period boundaries (from <= date < to)', async () => {
    const dv = (value: unknown) => ({ value, formattedValue: String(value) });
    const rows = [
      [dv(100), dv(new Date('2024-01-01T00:00:00.000Z'))], // == periodA.from -> in A
      [dv(200), dv(new Date('2024-02-01T00:00:00.000Z'))], // == periodA.to == periodB.from -> in B, not A
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
                    { fieldName: 'Umsatz', dataType: 'float', index: 0 },
                    { fieldName: 'Datum', dataType: 'date', index: 1 },
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
      call('compare_periods', {
        worksheet: 'W',
        dateColumn: 'Datum',
        measure: 'Umsatz',
        periodA: { from: '2024-01-01', to: '2024-02-01' },
        periodB: { from: '2024-02-01', to: '2024-03-01' },
      }),
      fakeDashboard,
    );
    expect(result).toContain('= 100');
    expect(result).toContain('= 200');
  });
});
