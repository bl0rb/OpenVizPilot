import { render } from 'preact';
import { eventType, getTableau, type FormattingSheet } from './tableau/api';
import { applyWorkbookFormatting } from './tableau/formatting';
import { App } from './ui/App';
import './ui/styles.css';

function showFatal(root: HTMLElement, message: string): void {
  render(
    <div style="padding:20px;color:#8f2a20;font-family:sans-serif;line-height:1.5">
      <strong>OpenVizPilot konnte nicht starten.</strong>
      <div>{message}</div>
    </div>,
    root,
  );
}

async function bootstrap(): Promise<void> {
  const root = document.getElementById('app');
  if (!root) return;

  const useMock = import.meta.env.MODE === 'mock' || import.meta.env.VITE_MOCK === '1';
  if (useMock) {
    const { installMockTableau } = await import('./mock/tableau-mock');
    installMockTableau();
  }

  try {
    const tableau = getTableau();
    await tableau.extensions.initializeAsync();
    const dashboard = tableau.extensions.dashboardContent?.dashboard;
    if (!dashboard) {
      throw new Error('Kein Dashboard-Kontext — die Extension muss in einem Dashboard geladen werden.');
    }
    // Schrift und Textfarbe des Workbooks übernehmen, damit das Panel nicht
    // als einziges Objekt im Dashboard aus der Reihe fällt — und beim Ändern
    // des Formats (Autor in Desktop) sofort nachziehen statt erst nach Reload.
    applyWorkbookFormatting();
    try {
      dashboard.addEventListener?.(eventType('WorkbookFormattingChanged'), (event) => {
        // Die neuen Vorlagen stehen NUR im Event: environment.workbookFormatting
        // ist die Momentaufnahme vom Start und wird von Tableau nie erneuert.
        const formatting = (event as { formatting?: { formattingSheets?: FormattingSheet[] } } | null)?.formatting;
        applyWorkbookFormatting(document.documentElement, formatting?.formattingSheets);
      });
    } catch {
      // Event auf dieser Tableau-Version unbekannt — Formatierung bleibt statisch.
    }

    render(<App dashboard={dashboard} />, root);
  } catch (err) {
    showFatal(root, err instanceof Error ? err.message : String(err));
  }
}

void bootstrap();
