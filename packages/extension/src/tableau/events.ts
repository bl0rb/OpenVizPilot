import type { Dashboard, MarksCollection, Unregister, Worksheet } from './api';
import { eventType } from './api';

const DEBOUNCE_MS = 500;

/** Was sich geändert hat — für die Anzeige und damit der Snapshot gezielt neu gebaut wird. */
export interface ContextChange {
  kind: 'filter' | 'parameter' | 'data' | 'layout';
  /** Feld bzw. Parametername, soweit das Event ihn mitliefert. */
  name?: string;
}

export interface ContextEventHandlers {
  /** Der Snapshot ist veraltet und wird vor dem nächsten Senden neu gebaut. */
  onDirty: (change: ContextChange) => void;
  /**
   * Der Anwender hat im Dashboard etwas an- oder abgewählt. Bewusst KEIN
   * onDirty: Der Snapshot enthält gar keine Markierungen (er liest mit
   * `ignoreSelection: true`), ein Klick auf eine Marke müsste ihn also nicht
   * verwerfen. Marks holt das Modell bei Bedarf live über get_selected_marks.
   *
   * Die eine Lücke, die dabei bleibt, ist bewusst in Kauf genommen: Eine
   * Set-Action kann durch Markauswahl Daten ändern, ohne dass ein Filter
   * feuert. Ab Tableau 2024.1 fängt SummaryDataChanged genau das ab; auf
   * älteren Versionen kann allein die Zeilenzahl im Snapshot kurz veralten —
   * Tool-Ergebnisse sind davon nicht betroffen, die sind immer live.
   */
  onSelection?: (worksheetName: string | null) => void;
}

/** Liest den Worksheet-Namen aus einem Event, ohne sich auf dessen Form zu verlassen. */
function worksheetNameOf(event: unknown): string | null {
  const ws = (event as { worksheet?: { name?: unknown } } | null)?.worksheet;
  return typeof ws?.name === 'string' ? ws.name : null;
}

/** Feld- bzw. Parametername aus dem Event, soweit vorhanden. */
function changedNameOf(event: unknown): string | undefined {
  const e = event as { fieldName?: unknown; parameterName?: unknown } | null;
  if (typeof e?.fieldName === 'string') return e.fieldName;
  if (typeof e?.parameterName === 'string') return e.parameterName;
  return undefined;
}

/**
 * Registriert Listener für alle kontextrelevanten Dashboard-Events und meldet
 * (debounced) EINMAL "Kontext ist veraltet", inklusive der Ursache. Der
 * Snapshot wird nicht sofort neu gebaut, sondern lazy vor dem nächsten Senden.
 *
 * Änderungen am Layout (Zonen ein-/ausblenden) binden die Worksheet-Listener
 * neu, weil `dashboard.worksheets` dabei ein anderes Array sein kann.
 */
export function registerContextInvalidation(
  dashboard: Dashboard,
  handlers: ContextEventHandlers,
): Unregister {
  let sheetUnregisters: Unregister[] = [];
  // Getrennt von den Worksheet-Listenern: bindWorksheets() räumt sein Array beim
  // Neubinden komplett leer, und Parameter werden nur EINMAL abonniert — lägen
  // sie im selben Array, wäre nach dem ersten Layout-Wechsel jede
  // Parameteränderung unbemerkt.
  const parameterUnregisters: Unregister[] = [];
  const dashboardUnregisters: Unregister[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: ContextChange | null = null;
  let stopped = false;

  const markDirty = (change: ContextChange) => {
    // Mehrere Ereignisse im Fenster: die zuletzt gemeldete Ursache gewinnt,
    // aber gemeldet wird nur einmal.
    pending = change;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      const reported = pending ?? { kind: 'data' as const };
      pending = null;
      handlers.onDirty(reported);
    }, DEBOUNCE_MS);
  };

  const listen = (
    target: { addEventListener?: (t: string, h: (e: unknown) => void) => Unregister },
    type: string,
    handler: (event: unknown) => void,
    into: Unregister[],
  ) => {
    try {
      const un = target.addEventListener?.(type, handler);
      if (un) into.push(un);
    } catch {
      // Event-Typ auf diesem Objekt/dieser Tableau-Version nicht unterstützt.
    }
  };

  /**
   * Meldet eine Auswahl nur, wenn wirklich etwas ausgewählt IST. Das Ereignis
   * feuert auch beim Abwählen und nach einem eigenen „Markieren"-Chip — ein
   * Angebot „Auswahl auswerten" wäre dann sinnlos bis irreführend.
   */
  const reportSelection = async (event: unknown, ws: Worksheet) => {
    if (!handlers.onSelection) return;
    try {
      const getMarks = (event as { getMarksAsync?: () => Promise<MarksCollection> } | null)?.getMarksAsync;
      const marks = getMarks ? await getMarks.call(event) : await ws.getSelectedMarksAsync();
      const hasSelection = marks.data.some((t) => t.data.length > 0);
      if (stopped) return;
      handlers.onSelection(hasSelection ? (worksheetNameOf(event) ?? ws.name) : null);
    } catch {
      // Marks nicht lesbar — dann lieber nichts anbieten als etwas Falsches.
      if (!stopped) handlers.onSelection(null);
    }
  };

  const bindWorksheets = () => {
    for (const un of sheetUnregisters) {
      try {
        un();
      } catch {
        // egal
      }
    }
    sheetUnregisters = [];
    if (stopped) return;

    for (const ws of dashboard.worksheets) {
      listen(ws, eventType('FilterChanged'), (e) => markDirty({ kind: 'filter', name: changedNameOf(e) }), sheetUnregisters);
      listen(ws, eventType('SummaryDataChanged'), () => markDirty({ kind: 'data', name: ws.name }), sheetUnregisters);
      listen(ws, eventType('MarkSelectionChanged'), (e) => void reportSelection(e, ws), sheetUnregisters);
    }
  };

  bindWorksheets();

  // ParameterChanged wird auf dem jeweiligen Parameter-Objekt registriert.
  void dashboard
    .getParametersAsync()
    .then((params) => {
      if (stopped) return;
      for (const p of params) {
        listen(p, eventType('ParameterChanged'), () => markDirty({ kind: 'parameter', name: p.name }), parameterUnregisters);
      }
    })
    .catch(() => undefined);

  // Zonen ein-/ausgeblendet: Der Snapshot beschreibt, was sichtbar ist, und die
  // Worksheet-Liste kann sich dabei ändern — beides muss nachgezogen werden.
  listen(
    dashboard,
    eventType('DashboardLayoutChanged'),
    () => {
      bindWorksheets();
      markDirty({ kind: 'layout' });
    },
    dashboardUnregisters,
  );

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    for (const un of [...sheetUnregisters, ...parameterUnregisters, ...dashboardUnregisters]) {
      try {
        un();
      } catch {
        // egal
      }
    }
    sheetUnregisters = [];
  };
}

/** Klartext der Änderung für die Anzeige im Kopf des Panels. */
export function describeContextChange(change: ContextChange): string {
  switch (change.kind) {
    case 'filter':
      return change.name ? `Filter „${change.name}" geändert` : 'Filter geändert';
    case 'parameter':
      return change.name ? `Parameter „${change.name}" geändert` : 'Parameter geändert';
    case 'layout':
      return 'Dashboard-Layout geändert';
    case 'data':
      return change.name ? `Daten in „${change.name}" geändert` : 'Dashboard geändert';
  }
}
