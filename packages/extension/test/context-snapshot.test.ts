import { describe, expect, it } from 'vitest';
import { createMockTableau } from '../src/mock/tableau-mock';
import { buildContextSnapshot } from '../src/tableau/context-snapshot';

describe('buildContextSnapshot', () => {
  it('contains structure, columns, filters and parameters — but no data rows', async () => {
    const { api, state } = createMockTableau();
    const dashboard = api.extensions.dashboardContent?.dashboard;
    if (!dashboard) throw new Error('mock ohne dashboard');

    const snapshot = await buildContextSnapshot(dashboard);

    expect(snapshot).toContain('# Dashboard: Vertriebsübersicht (Mock)');
    expect(snapshot).toContain('## Worksheet: Umsatz nach Region');
    expect(snapshot).toContain('Region (string)');
    expect(snapshot).toContain('Aktive Filter:');
    expect(snapshot).toContain('Zeitraum = Letzte 12 Monate');
    // Keine Datenzeilen im Snapshot:
    expect(snapshot).not.toContain('Nord');
    expect(snapshot).not.toContain('Alpha-Serie');
    // Alle Reader wieder freigegeben:
    expect(state.openReaders['Umsatz nach Region']).toBe(0);
    expect(state.openReaders['Top Produkte']).toBe(0);
  });
});
