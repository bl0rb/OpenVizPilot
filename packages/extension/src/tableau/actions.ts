import { dashboardActionSchema, type DashboardAction } from '@openvizpilot/shared';
import { findWorksheet } from '../tools/executors/helpers';
import { getTableau, selectionUpdateType, type Dashboard } from './api';

/**
 * Führt eine vom LLM VORGESCHLAGENE Dashboard-Aktion aus.
 *
 * SICHERHEITSINVARIANTE: Diese Funktion wird ausschließlich aus dem
 * Klick-Handler eines Action-Chips aufgerufen — nie aus dem Agenten-Loop,
 * nie aus einem Tool-Call, nie automatisch. Das ist die Human-in-the-Loop-
 * Absicherung gegen Prompt-Injection über Dashboard-Inhalte.
 */
export async function executeDashboardAction(
  action: DashboardAction,
  dashboard: Dashboard,
): Promise<string> {
  // Zweite Validierung zum Ausführungszeitpunkt (Defense in depth).
  const validated = dashboardActionSchema.safeParse(action);
  if (!validated.success) {
    throw new Error('Ungültige Aktion — nicht ausgeführt.');
  }
  const a = validated.data;

  switch (a.type) {
    case 'apply_filter': {
      const ws = findWorksheet(dashboard, a.worksheet);
      if (!ws.applyFilterAsync) {
        throw new Error('Filter setzen wird von dieser Tableau-Version nicht unterstützt.');
      }
      await ws.applyFilterAsync(a.field, a.values, 'replace', { isExcludeMode: false });
      return `Filter angewendet: „${a.field}" = ${a.values.join(', ')} (Worksheet „${ws.name}").`;
    }
    case 'clear_filter': {
      const ws = findWorksheet(dashboard, a.worksheet);
      if (!ws.clearFilterAsync) {
        throw new Error('Filter zurücksetzen wird von dieser Tableau-Version nicht unterstützt.');
      }
      await ws.clearFilterAsync(a.field);
      return `Filter „${a.field}" zurückgesetzt (Worksheet „${ws.name}").`;
    }
    case 'set_parameter': {
      const parameters = await dashboard.getParametersAsync();
      const parameter = parameters.find((p) => p.name === a.parameter);
      if (!parameter) {
        const available = parameters.map((p) => `"${p.name}"`).join(', ') || '(keine)';
        throw new Error(`Parameter "${a.parameter}" nicht gefunden. Verfügbar: ${available}`);
      }
      if (!parameter.changeValueAsync) {
        throw new Error('Parameter ändern wird von dieser Tableau-Version nicht unterstützt.');
      }
      await parameter.changeValueAsync(a.value);
      return `Parameter „${a.parameter}" auf ${a.value} gesetzt.`;
    }
    case 'select_marks': {
      const ws = findWorksheet(dashboard, a.worksheet);
      if (!ws.selectMarksByValueAsync) {
        throw new Error('Markieren wird von dieser Tableau-Version nicht unterstützt.');
      }
      await ws.selectMarksByValueAsync(
        [{ fieldName: a.field, value: a.values }],
        selectionUpdateType('Replace'),
      );
      return `Markiert: „${a.field}" = ${a.values.join(', ')} (Worksheet „${ws.name}").`;
    }
    case 'activate_sheet': {
      const workbook = getTableau().extensions.workbook;
      if (!workbook?.activateSheetAsync) {
        throw new Error('Sheet-Wechsel wird von dieser Tableau-Version nicht unterstützt.');
      }
      // Wechselt die Ansicht — die Extension wird dabei ggf. entladen, deshalb
      // ist die Rückmeldung nur noch für den Mock/Dev-Fall sichtbar.
      await workbook.activateSheetAsync(a.sheet);
      return `Gewechselt zu Sheet „${a.sheet}".`;
    }
  }
}
