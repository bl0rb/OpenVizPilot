import type { DashboardAction } from '@openvizpilot/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { createMockTableau } from '../src/mock/tableau-mock';
import { executeDashboardAction } from '../src/tableau/actions';
import { EVENT_TYPES, type Dashboard } from '../src/tableau/api';
import { executeToolCall } from '../src/tools/registry';

let dashboard: Dashboard;
let state: ReturnType<typeof createMockTableau>['state'];

beforeEach(() => {
  const mock = createMockTableau();
  state = mock.state;
  const db = mock.api.extensions.dashboardContent?.dashboard;
  if (!db) throw new Error('mock ohne dashboard');
  dashboard = db;
});

const filterAction: DashboardAction = {
  type: 'apply_filter',
  worksheet: 'Umsatz nach Region',
  field: 'Region',
  values: ['Süd'],
  label: 'Süd filtern',
};

describe('executeDashboardAction', () => {
  it('applies a filter, fires FilterChanged and is visible to the read tools', async () => {
    let filterEvents = 0;
    dashboard.worksheets[0]?.addEventListener(EVENT_TYPES.FilterChanged, () => filterEvents++);

    const message = await executeDashboardAction(filterAction, dashboard);
    expect(message).toContain('Region');
    expect(message).toContain('Süd');
    expect(state.actions).toContain('apply_filter:Umsatz nach Region:Region=Süd');
    expect(filterEvents).toBe(1);

    const filters = await executeToolCall(
      { id: 'c', type: 'function', function: { name: 'get_filters', arguments: '{}' } },
      dashboard,
    );
    expect(filters).toContain('Region: Süd');
  });

  it('clears a filter', async () => {
    await executeDashboardAction(filterAction, dashboard);
    const message = await executeDashboardAction(
      { type: 'clear_filter', worksheet: 'Umsatz nach Region', field: 'Region', label: 'x' },
      dashboard,
    );
    expect(message).toContain('zurückgesetzt');
    expect(state.actions).toContain('clear_filter:Umsatz nach Region:Region');
  });

  it('sets a parameter and fires ParameterChanged', async () => {
    const message = await executeDashboardAction(
      { type: 'set_parameter', parameter: 'Zeitraum', value: 'Vorjahr', label: 'x' },
      dashboard,
    );
    expect(message).toContain('Zeitraum');
    const params = await dashboard.getParametersAsync();
    expect(params.find((p) => p.name === 'Zeitraum')?.currentValue.formattedValue).toBe('Vorjahr');
  });

  it('parameter changes do not leak into a fresh mock instance', async () => {
    await executeDashboardAction(
      { type: 'set_parameter', parameter: 'Zeitraum', value: 'Vorjahr', label: 'x' },
      dashboard,
    );
    const fresh = createMockTableau().api.extensions.dashboardContent?.dashboard;
    const params = await fresh?.getParametersAsync();
    expect(params?.find((p) => p.name === 'Zeitraum')?.currentValue.formattedValue).toBe(
      'Letzte 12 Monate',
    );
  });

  it('rejects unknown worksheets with a self-explanatory error', async () => {
    await expect(
      executeDashboardAction({ ...filterAction, worksheet: 'Falsch' }, dashboard),
    ).rejects.toThrow('nicht gefunden');
  });

  it('rejects unknown parameters', async () => {
    await expect(
      executeDashboardAction(
        { type: 'set_parameter', parameter: 'GibtEsNicht', value: '1', label: 'x' },
        dashboard,
      ),
    ).rejects.toThrow('Verfügbar');
  });

  it('rejects malformed actions at execution time (defense in depth)', async () => {
    const malformed = { type: 'apply_filter', worksheet: 'Umsatz nach Region', label: 'x' };
    await expect(
      executeDashboardAction(malformed as unknown as DashboardAction, dashboard),
    ).rejects.toThrow('Ungültige Aktion');
  });
});
