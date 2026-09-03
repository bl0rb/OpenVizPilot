import { afterEach, describe, expect, it, vi } from 'vitest';
import { executeDashboardAction } from '../src/tableau/actions';
import type { Dashboard, Worksheet } from '../src/tableau/api';

/**
 * Markierungs-Chips und Sheet-Navigation — beide laufen ausschließlich über
 * executeDashboardAction (Klick-Handler), siehe tableau/actions.ts.
 */

function fakeWorksheet(name: string, overrides: Partial<Worksheet> = {}): Worksheet {
  return {
    name,
    async getSummaryDataReaderAsync() {
      throw new Error('unused');
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
    addEventListener: () => () => undefined,
    ...overrides,
  };
}

function fakeDashboard(worksheets: Worksheet[]): Dashboard {
  return { name: 'Test', worksheets, async getParametersAsync() { return []; } };
}

afterEach(() => {
  delete (globalThis as Record<string, unknown>).tableau;
});

describe('select_marks', () => {
  it('selects marks by value with a REPLACE update on the named worksheet', async () => {
    const select = vi.fn(async () => undefined);
    const dashboard = fakeDashboard([fakeWorksheet('Umsatz', { selectMarksByValueAsync: select })]);
    const message = await executeDashboardAction(
      { type: 'select_marks', worksheet: 'Umsatz', field: 'Region', values: ['Nord', 'Süd'], label: 'Top' },
      dashboard,
    );
    expect(select).toHaveBeenCalledWith([{ fieldName: 'Region', value: ['Nord', 'Süd'] }], 'select-replace');
    expect(message).toContain('Markiert');
  });

  it('uses the runtime enum value when tableau.SelectionUpdateType exists', async () => {
    (globalThis as Record<string, unknown>).tableau = {
      extensions: {},
      SelectionUpdateType: { Replace: 'runtime-replace' },
    };
    const select = vi.fn(async () => undefined);
    const dashboard = fakeDashboard([fakeWorksheet('Umsatz', { selectMarksByValueAsync: select })]);
    await executeDashboardAction(
      { type: 'select_marks', worksheet: 'Umsatz', field: 'Region', values: ['Nord'], label: 'x' },
      dashboard,
    );
    expect(select).toHaveBeenCalledWith(expect.anything(), 'runtime-replace');
  });

  it('fails clearly when the worksheet does not exist or the API lacks the method', async () => {
    const dashboard = fakeDashboard([fakeWorksheet('Umsatz')]);
    await expect(
      executeDashboardAction({ type: 'select_marks', worksheet: 'Gibt es nicht', field: 'R', values: ['x'], label: 'x' }, dashboard),
    ).rejects.toThrow(/nicht gefunden/);
    await expect(
      executeDashboardAction({ type: 'select_marks', worksheet: 'Umsatz', field: 'R', values: ['x'], label: 'x' }, dashboard),
    ).rejects.toThrow(/nicht unterstützt/);
  });
});

describe('activate_sheet', () => {
  it('activates the sheet through the workbook of the runtime', async () => {
    const activate = vi.fn(async () => undefined);
    (globalThis as Record<string, unknown>).tableau = { extensions: { workbook: { activateSheetAsync: activate } } };
    const message = await executeDashboardAction(
      { type: 'activate_sheet', sheet: 'Details', label: 'Zu den Details' },
      fakeDashboard([]),
    );
    expect(activate).toHaveBeenCalledWith('Details');
    expect(message).toContain('Details');
  });

  it('fails clearly when the runtime has no activateSheetAsync', async () => {
    (globalThis as Record<string, unknown>).tableau = { extensions: {} };
    await expect(
      executeDashboardAction({ type: 'activate_sheet', sheet: 'Details', label: 'x' }, fakeDashboard([])),
    ).rejects.toThrow(/nicht unterstützt/);
  });

  it('surfaces the runtime error for unknown sheets', async () => {
    (globalThis as Record<string, unknown>).tableau = {
      extensions: {
        workbook: {
          async activateSheetAsync() {
            throw new Error('Sheet "Nix" nicht gefunden.');
          },
        },
      },
    };
    await expect(
      executeDashboardAction({ type: 'activate_sheet', sheet: 'Nix', label: 'x' }, fakeDashboard([])),
    ).rejects.toThrow(/nicht gefunden/);
  });
});
