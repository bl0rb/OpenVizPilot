import type { ToolCall } from '@openvizpilot/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMockTableau } from '../src/mock/tableau-mock';
import { executeDashboardAction } from '../src/tableau/actions';
import type { Dashboard } from '../src/tableau/api';
import { buildContextSnapshot } from '../src/tableau/context-snapshot';
import { describeContextChange, registerContextInvalidation } from '../src/tableau/events';
import { applyWorkbookFormatting, type StyleTarget } from '../src/tableau/formatting';
import { executeToolCall } from '../src/tools/registry';

/**
 * Die Oberfläche, die der Assistent vom Dashboard sieht: was hervorgehoben ist,
 * welche Zonen sichtbar sind, woher die Daten kommen, wie das Panel aussieht —
 * und welche Ereignisse den Kontext wirklich veralten lassen.
 */

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

describe('hervorgehobene Marks', () => {
  it('fällt auf Highlights zurück, wenn nichts selektiert ist, und sagt das dazu', async () => {
    // "Auftragsdetails" hat keine Selektion, aber zwei hervorgehobene Zeilen.
    const result = await executeToolCall(call('get_selected_marks', { worksheet: 'Auftragsdetails' }), dashboard);

    expect(result).toMatch(/hervorgehoben/i);
    expect(result).toContain('Produkt A');
    // Der Assistent darf das nicht als Auswahl des Nutzers ausgeben.
    expect(result).not.toMatch(/^In "Auftragsdetails" sind aktuell keine Marks/);
  });

  it('bevorzugt die echte Selektion, wenn es eine gibt', async () => {
    const result = await executeToolCall(call('get_selected_marks', { worksheet: 'Umsatz nach Region' }), dashboard);
    expect(result).not.toMatch(/hervorgehoben/i);
    expect(result).toContain('Nord');
  });

  it('meldet ehrlich, wenn weder selektiert noch hervorgehoben ist', async () => {
    const result = await executeToolCall(call('get_selected_marks', { worksheet: 'Top Produkte' }), dashboard);
    expect(result).toContain('keine Marks selektiert oder hervorgehoben');
  });
});

describe('Herkunft der Daten', () => {
  it('nennt die Verbindung der Datenquelle, aber keine Server-Adresse', async () => {
    const result = await executeToolCall(call('get_datasource_info', { worksheet: 'Umsatz nach Region' }), dashboard);
    expect(result).toContain('Verbindungen:');
    expect(result).toContain('hyper');
    expect(result).not.toMatch(/https?:\/\//);
  });
});

describe('Zonen im Kontext', () => {
  it('markiert ausgeblendete Worksheets und listet die Bedienelemente', async () => {
    const snapshot = await buildContextSnapshot(dashboard);

    expect(snapshot).toContain('## Worksheet: Auftragsdetails (im Dashboard aktuell ausgeblendet)');
    expect(snapshot).toContain('## Worksheet: Umsatz nach Region\n');
    expect(snapshot).toContain('## Bedienelemente im Dashboard');
    expect(snapshot).toContain('- Region (Filter-Steuerelement)');
    expect(snapshot).toContain('- Mindestumsatz (Parameter-Steuerelement)');
    // Die eigene Extension ist kein Bedienelement des Dashboards.
    expect(snapshot).not.toContain('OpenVizPilot (');
  });

  it('sagt es, wenn die Liste der Bedienelemente gekürzt ist', async () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      id: 100 + i,
      name: `Filter ${i}`,
      type: 'quick-filter',
      isVisible: true,
    }));
    const snapshot = await buildContextSnapshot({ ...dashboard, objects: many });

    expect(snapshot).toContain('- Filter 0 (Filter-Steuerelement)');
    expect(snapshot).toContain('weitere (nicht aufgeführt)');
    // Sonst hielte das Modell die gekürzte Liste für vollständig.
    expect(snapshot).not.toContain('- Filter 19 ');
  });

  it('behauptet nichts, wenn die Tableau-Version keine Zonen liefert', async () => {
    const withoutZones: Dashboard = { ...dashboard, objects: undefined };
    const snapshot = await buildContextSnapshot(withoutZones);

    expect(snapshot).toContain('## Worksheet: Auftragsdetails');
    expect(snapshot).not.toContain('ausgeblendet');
    expect(snapshot).not.toContain('## Bedienelemente');
  });
});

describe('Zone ein-/ausblenden (Action-Chip)', () => {
  it('blendet über den Namen ein und meldet es zurück', async () => {
    const message = await executeDashboardAction(
      { type: 'set_zone_visibility', zone: 'Auftragsdetails', visible: true, label: 'Details zeigen' },
      dashboard,
    );

    expect(message).toContain('eingeblendet');
    expect(state.actions).toContain('set_zone_visibility:Auftragsdetails=show');
    expect(dashboard.objects?.find((o) => o.name === 'Auftragsdetails')?.isVisible).toBe(true);
  });

  it('erfindet keine Zone', async () => {
    await expect(
      executeDashboardAction(
        { type: 'set_zone_visibility', zone: 'Gibt es nicht', visible: false, label: 'x' },
        dashboard,
      ),
    ).rejects.toThrow(/nicht gefunden/);
  });
});

describe('Kontext-Ereignisse', () => {
  it('verwirft den Kontext nicht wegen einer Markierung, meldet aber das richtige Worksheet', async () => {
    const changes: string[] = [];
    const selections: Array<string | null> = [];
    const stop = registerContextInvalidation(dashboard, {
      onDirty: (c) => changes.push(c.kind),
      onSelection: (ws) => selections.push(ws),
    });

    // "Umsatz nach Region" hat im Mock eine echte Selektion.
    state.emit('mark-selection-changed', 'Umsatz nach Region');
    await new Promise((r) => setTimeout(r, 0));

    expect(selections).toEqual(['Umsatz nach Region']);
    // Eine Markierung ist keine Kontextänderung.
    expect(changes).toEqual([]);
    stop();
  });

  it('bietet nichts an, wenn die Markierung aufgehoben wurde', async () => {
    const selections: Array<string | null> = [];
    const stop = registerContextInvalidation(dashboard, {
      onDirty: () => undefined,
      onSelection: (ws) => selections.push(ws),
    });

    // "Top Produkte" hat keine Selektion — das Ereignis feuert auch beim Abwählen.
    state.emit('mark-selection-changed', 'Top Produkte');
    await new Promise((r) => setTimeout(r, 0));

    expect(selections).toEqual([null]);
    stop();
  });

  it('verliert die Parameter-Listener nicht, wenn sich das Layout ändert', async () => {
    const changes: string[] = [];
    const stop = registerContextInvalidation(dashboard, { onDirty: (c) => changes.push(c.kind) });
    await new Promise((r) => setTimeout(r, 0)); // getParametersAsync abwarten

    // Layout-Wechsel bindet die Worksheet-Listener neu …
    state.emit('dashboard-layout-changed');
    // … danach muss eine Parameteränderung weiterhin ankommen.
    state.emit('parameter-changed');
    await new Promise((r) => setTimeout(r, 600));

    expect(changes).toContain('parameter');
    stop();
  });

  it('sagt in Klartext, was sich geändert hat', () => {
    expect(describeContextChange({ kind: 'filter', name: 'Region' })).toBe('Filter „Region" geändert');
    expect(describeContextChange({ kind: 'parameter', name: 'Mindestumsatz' })).toBe('Parameter „Mindestumsatz" geändert');
    expect(describeContextChange({ kind: 'layout' })).toBe('Dashboard-Layout geändert');
    expect(describeContextChange({ kind: 'data' })).toBe('Dashboard geändert');
  });
});

describe('Workbook-Formatierung', () => {
  // applyWorkbookFormatting liest das globale `tableau`, nicht das Dashboard.
  let environment: Record<string, unknown>;

  beforeEach(() => {
    const mock = createMockTableau();
    (globalThis as Record<string, unknown>).tableau = mock.api;
    environment = mock.api.extensions.environment as unknown as Record<string, unknown>;
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).tableau;
  });

  /** Fake-Ziel statt DOM: Die Tests laufen in Node, nicht im Browser. */
  function root(): StyleTarget & { vars: Record<string, string> } {
    const vars: Record<string, string> = {};
    return {
      vars,
      style: {
        setProperty: (name, value) => void (vars[name] = value),
        removeProperty: (name) => void delete vars[name],
      },
    };
  }

  it('übernimmt Schrift und lesbare Textfarbe des Workbooks', () => {
    const el = root();
    const applied = applyWorkbookFormatting(el);

    expect(applied.fontFamily).toBe('Georgia, serif');
    expect(applied.color).toBe('#2b2b2b');
    expect(el.vars['--ovp-font-family']).toBe('Georgia, serif');
    expect(el.vars['--ovp-color']).toBe('#2b2b2b');
  });

  it('verwirft eine Textfarbe, die auf weißem Grund unlesbar wäre', () => {
    environment.workbookFormatting = {
      formattingSheets: [
        { classNameKey: 'tableau-worksheet', cssProperties: { fontFamily: 'Arial', color: '#f2f2f2' } },
      ],
    };

    const el = root();
    const applied = applyWorkbookFormatting(el);

    expect(applied.fontFamily).toBe('Arial');
    expect(applied.color).toBeUndefined();
    expect(applied.rejectedColor).toBe('#f2f2f2');
    expect(el.vars['--ovp-color']).toBeUndefined();
  });

  it('nimmt die Formatierung aus dem Änderungs-Event, nicht aus der alten Momentaufnahme', () => {
    const el = root();
    applyWorkbookFormatting(el);
    expect(el.vars['--ovp-font-family']).toBe('Georgia, serif');

    // Wie beim WorkbookFormattingChanged-Event: neue Vorlagen, environment bleibt alt.
    applyWorkbookFormatting(el, [
      { classNameKey: 'tableau-worksheet', cssProperties: { fontFamily: 'Verdana, sans-serif' } },
    ]);

    expect(el.vars['--ovp-font-family']).toBe('Verdana, sans-serif');
    // Was das neue Format nicht mehr vorgibt, muss verschwinden statt stehenzubleiben.
    expect(el.vars['--ovp-color']).toBeUndefined();
    expect(el.vars['--ovp-title-font-family']).toBeUndefined();
  });

  it('rechnet halbtransparente Farben gegen den weißen Grund', () => {
    const el = root();
    // rgba(0,0,0,0.1) sieht auf Weiß fast weiß aus — darf nicht durchkommen.
    const applied = applyWorkbookFormatting(el, [
      { classNameKey: 'tableau-worksheet', cssProperties: { color: 'rgba(0, 0, 0, 0.1)' } },
    ]);
    expect(applied.color).toBeUndefined();
    expect(applied.rejectedColor).toBe('rgba(0, 0, 0, 0.1)');

    // Dieselbe Farbe deckend ist einwandfrei lesbar.
    expect(applyWorkbookFormatting(root(), [
      { classNameKey: 'tableau-worksheet', cssProperties: { color: 'rgb(0, 0, 0)' } },
    ]).color).toBe('rgb(0, 0, 0)');
  });

  it('lässt keine CSS-Injektion durch', () => {
    environment.workbookFormatting = {
      formattingSheets: [
        {
          classNameKey: 'tableau-worksheet',
          cssProperties: { fontFamily: 'Arial; background: url(https://evil.example/x)', color: '#333' },
        },
      ],
    };

    const el = root();
    expect(applyWorkbookFormatting(el).fontFamily).toBeUndefined();
    expect(el.vars['--ovp-font-family']).toBeUndefined();
  });
});
