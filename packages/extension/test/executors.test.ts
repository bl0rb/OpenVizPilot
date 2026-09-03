import type { ToolCall } from '@openvizpilot/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { createMockTableau } from '../src/mock/tableau-mock';
import type { Dashboard } from '../src/tableau/api';
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

describe('executeToolCall', () => {
  it('list_worksheets returns all names', async () => {
    const result = await executeToolCall(call('list_worksheets'), dashboard);
    expect(result).toContain('Umsatz nach Region');
    expect(result).toContain('Top Produkte');
  });

  it('get_worksheet_fields lists columns with types and releases the reader', async () => {
    const result = await executeToolCall(call('get_worksheet_fields', { worksheet: 'Umsatz nach Region' }), dashboard);
    expect(result).toContain('Region (string)');
    expect(result).toContain('SUM(Umsatz) (float)');
    expect(state.releases['Umsatz nach Region']).toBe(1);
    expect(state.openReaders['Umsatz nach Region']).toBe(0);
  });

  it('get_worksheet_summary_data returns a markdown table with row counts', async () => {
    const result = await executeToolCall(
      call('get_worksheet_summary_data', { worksheet: 'Umsatz nach Region', maxRows: 2 }),
      dashboard,
    );
    expect(result).toContain('| Region |');
    expect(result).toContain('Nord');
    expect(result).not.toContain('Ost'); // maxRows 2 → nur die ersten beiden Zeilen
    expect(result).toContain('Zeige 2 von 4 Zeilen');
    expect(state.openReaders['Umsatz nach Region']).toBe(0);
  });

  it('get_worksheet_summary_data escapes pipes in cell values', async () => {
    const result = await executeToolCall(
      call('get_worksheet_summary_data', { worksheet: 'Top Produkte' }),
      dashboard,
    );
    expect(result).toContain('Beta \\| Spezial');
  });

  it('supports column projection and reports missing columns', async () => {
    const result = await executeToolCall(
      call('get_worksheet_summary_data', {
        worksheet: 'Umsatz nach Region',
        columns: ['Region', 'GibtEsNicht'],
      }),
      dashboard,
    );
    expect(result).toContain('| Region |');
    expect(result).not.toContain('SUM(Umsatz) |');
    expect(result).toContain('GibtEsNicht');
  });

  it('returns a self-correcting error for unknown worksheets (and never throws)', async () => {
    const result = await executeToolCall(call('get_filters', { worksheet: 'Falsch' }), dashboard);
    expect(result).toContain('nicht gefunden');
    expect(result).toContain('Umsatz nach Region');
  });

  it('rejects invalid arguments via schema validation', async () => {
    const result = await executeToolCall(
      call('get_worksheet_summary_data', { worksheet: 'Top Produkte', maxRows: 99_999 }),
      dashboard,
    );
    expect(result).toContain('Ungültige Argumente');
  });

  it('rejects unknown tools', async () => {
    const result = await executeToolCall(call('drop_database'), dashboard);
    expect(result).toContain('Unbekanntes Tool');
  });

  it('get_filters formats categorical and relative-date filters', async () => {
    const result = await executeToolCall(call('get_filters', {}), dashboard);
    expect(result).toContain('Region: alle Werte');
    expect(result).toContain('relatives Datum');
    expect(result).toContain('Kategorie: Maschinen, Ersatzteile, Service');
  });

  it('get_parameters lists values and ranges', async () => {
    const result = await executeToolCall(call('get_parameters'), dashboard);
    expect(result).toContain('Zeitraum = Letzte 12 Monate');
    expect(result).toContain('Zielmarge = 15 %');
    expect(result).toContain('0 % bis 100 %');
  });

  it('get_selected_marks returns the selection', async () => {
    const result = await executeToolCall(call('get_selected_marks', { worksheet: 'Umsatz nach Region' }), dashboard);
    expect(result).toContain('Nord');
  });

  it('get_selected_marks reports empty selection explicitly', async () => {
    const result = await executeToolCall(call('get_selected_marks', { worksheet: 'Top Produkte' }), dashboard);
    expect(result).toContain('keine Marks selektiert');
  });

  it('get_datasource_info lists fields without row data', async () => {
    const result = await executeToolCall(call('get_datasource_info', { worksheet: 'Umsatz nach Region' }), dashboard);
    expect(result).toContain('Vertrieb (Beispiel)');
    expect(result).toContain('Vertriebspartner');
    expect(result).not.toContain('125.000'); // keine Datenzeilen
  });

  it('summary reads ignore the current mark selection', async () => {
    await executeToolCall(call('get_worksheet_summary_data', { worksheet: 'Umsatz nach Region' }), dashboard);
    expect(state.readerOptions['Umsatz nach Region']?.ignoreSelection).toBe(true);
  });

  it('mock enforces the single-active-reader constraint of the real API', async () => {
    const ws = dashboard.worksheets[0];
    if (!ws) throw new Error('kein Worksheet im Mock');
    const reader = await ws.getSummaryDataReaderAsync(1);
    await expect(ws.getSummaryDataReaderAsync(1)).rejects.toThrow('bereits ein DataTableReader');
    await reader.releaseAsync();
  });

  it('handles broken JSON arguments gracefully', async () => {
    const broken: ToolCall = {
      id: 'x',
      type: 'function',
      function: { name: 'get_filters', arguments: '{invalid' },
    };
    const result = await executeToolCall(broken, dashboard);
    expect(result).toContain('kein gültiges JSON');
  });
});
