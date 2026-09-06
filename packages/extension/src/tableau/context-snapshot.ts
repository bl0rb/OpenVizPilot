import { MAX_CONTEXT_CHARS } from '@openvizpilot/shared';
import type { Dashboard, DashboardObject, DataTableReader, Filter, Parameter, Worksheet } from './api';

const MAX_FILTER_VALUES = 10;
/** So viele Bedienelemente nennt der Kontext höchstens — der Rest ist Rauschen. */
const MAX_CONTROLS = 15;

/** Zonentypen, die für den Anwender ein Bedienelement sind (keine Sichten, keine Deko). */
const CONTROL_TYPES: Record<string, string> = {
  'quick-filter': 'Filter-Steuerelement',
  'parameter-control': 'Parameter-Steuerelement',
  'page-filter': 'Seiten-Steuerelement',
  legend: 'Legende',
};

/**
 * Baut den kompakten System-Kontext: Dashboard-Struktur, Spalten + Typen,
 * aktive Filter, Parameter. NIE Datenzeilen — die holt das LLM per Tool.
 */
export async function buildContextSnapshot(dashboard: Dashboard): Promise<string> {
  const lines: string[] = [];
  lines.push(`# Dashboard: ${dashboard.name}`);
  lines.push('');

  // Zonen des Dashboards: Sie sagen, was der Anwender GERADE SIEHT. Ohne sie
  // beschreibt der Assistent auch Sichten, die hinter einem Show/Hide-Container
  // liegen — im Chat nicht von einer Halluzination zu unterscheiden.
  const zones = dashboard.objects ?? [];
  const hidden = hiddenWorksheetNames(zones);

  for (const ws of dashboard.worksheets) {
    lines.push(`## Worksheet: ${ws.name}${hidden.has(ws.name) ? ' (im Dashboard aktuell ausgeblendet)' : ''}`);
    try {
      lines.push(await describeColumns(ws));
    } catch (err) {
      lines.push(`(Spalten nicht lesbar: ${errMessage(err)})`);
    }
    try {
      const filters = await ws.getFiltersAsync();
      if (filters.length > 0) {
        lines.push('Aktive Filter:');
        for (const f of filters) {
          lines.push(`- ${describeFilter(f)}`);
        }
      } else {
        lines.push('Aktive Filter: keine');
      }
    } catch (err) {
      lines.push(`(Filter nicht lesbar: ${errMessage(err)})`);
    }
    lines.push('');
  }

  const controls = describeControls(zones);
  if (controls.length > 0) {
    lines.push('## Bedienelemente im Dashboard');
    lines.push(...controls);
    lines.push('');
  }

  try {
    const parameters = await dashboard.getParametersAsync();
    if (parameters.length > 0) {
      lines.push('## Parameter');
      for (const p of parameters) {
        lines.push(`- ${describeParameter(p)}`);
      }
      lines.push('');
    }
  } catch (err) {
    lines.push(`(Parameter nicht lesbar: ${errMessage(err)})`);
  }

  lines.push(`_Stand: ${new Date().toISOString()}_`);

  let snapshot = lines.join('\n');
  if (snapshot.length > MAX_CONTEXT_CHARS) {
    snapshot = `${snapshot.slice(0, MAX_CONTEXT_CHARS - 60)}\n\n_[Kontext gekürzt — Details per Tool abfragen]_`;
  }
  return snapshot;
}

/**
 * Namen der Worksheets, deren Zone ausgeblendet ist. Tableau meldet nur Zonen,
 * keine Container — ist die Sichtbarkeit nicht ermittelbar, gilt ein Worksheet
 * als sichtbar. Lieber nichts behaupten als das Falsche.
 */
function hiddenWorksheetNames(zones: DashboardObject[]): Set<string> {
  const names = new Set<string>();
  for (const z of zones) {
    if (z.type === 'worksheet' && z.isVisible === false && z.name) {
      names.add(z.name);
    }
  }
  return names;
}

/** Sichtbare Bedienelemente — damit der Assistent sagen kann, WO man etwas umstellt. */
function describeControls(zones: DashboardObject[]): string[] {
  const all = zones.filter((z) => CONTROL_TYPES[z.type] && z.isVisible !== false && z.name);
  const lines = all.slice(0, MAX_CONTROLS).map((z) => `- ${z.name} (${CONTROL_TYPES[z.type]})`);
  // Ohne diesen Hinweis hielte das Modell die gekürzte Liste für vollständig und
  // würde behaupten, es gebe kein Steuerelement für ein Feld, das es sehr wohl gibt.
  if (all.length > lines.length) {
    lines.push(`- … und ${all.length - lines.length} weitere (nicht aufgeführt)`);
  }
  return lines;
}

async function describeColumns(ws: Worksheet): Promise<string> {
  let reader: DataTableReader | null = null;
  try {
    reader = await ws.getSummaryDataReaderAsync(1, { ignoreSelection: true });
    const page = await reader.getPageAsync(0);
    const cols = page.columns
      .map((c) => `${c.fieldName} (${c.dataType})`)
      .join(', ');
    const total = reader.totalRowCount;
    return `Spalten: ${cols || '(keine)'}\nZeilen (aggregiert, gefiltert): ${total}`;
  } finally {
    if (reader) {
      await reader.releaseAsync().catch(() => undefined);
    }
  }
}

export function describeFilter(f: Filter): string {
  switch (f.filterType) {
    case 'categorical': {
      if (f.isAllSelected) return `${f.fieldName}: alle Werte`;
      const values = (f.appliedValues ?? []).map((v) => v.formattedValue);
      const shown = values.slice(0, MAX_FILTER_VALUES).join(', ');
      const more = values.length > MAX_FILTER_VALUES ? ` (+${values.length - MAX_FILTER_VALUES} weitere)` : '';
      const mode = f.isExcludeMode ? ' [ausgeschlossen]' : '';
      return `${f.fieldName}: ${shown || '(keine)'}${more}${mode}`;
    }
    case 'range': {
      const min = f.minValue?.formattedValue ?? '−∞';
      const max = f.maxValue?.formattedValue ?? '∞';
      const nulls = f.includeNullValues ? ' (inkl. Null)' : '';
      return `${f.fieldName}: ${min} bis ${max}${nulls}`;
    }
    case 'relative-date':
      return `${f.fieldName}: relatives Datum (${[f.rangeType, f.rangeN, f.periodType].filter((x) => x != null).join(' ')})`;
    default:
      return `${f.fieldName}: Filtertyp ${f.filterType}`;
  }
}

export function describeParameter(p: Parameter): string {
  let allowed = '';
  const av = p.allowableValues;
  if (av?.type === 'list' && av.allowableValues) {
    const values = av.allowableValues.map((v) => v.formattedValue);
    const shown = values.slice(0, MAX_FILTER_VALUES).join(', ');
    allowed = `; erlaubt: ${shown}${values.length > MAX_FILTER_VALUES ? ', …' : ''}`;
  } else if (av?.type === 'range') {
    allowed = `; Bereich: ${av.minValue?.formattedValue ?? '?'} bis ${av.maxValue?.formattedValue ?? '?'}`;
  }
  return `${p.name} = ${p.currentValue.formattedValue} (${p.dataType}${allowed})`;
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
