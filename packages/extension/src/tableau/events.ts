import type { Dashboard, Unregister } from './api';
import { eventType } from './api';

const DEBOUNCE_MS = 500;

/**
 * Registriert Listener für alle kontextrelevanten Dashboard-Events und meldet
 * (debounced) EINMAL "Kontext ist veraltet". Der Snapshot wird nicht sofort
 * neu gebaut, sondern lazy vor dem nächsten Senden.
 */
export function registerContextInvalidation(
  dashboard: Dashboard,
  onDirty: () => void,
): Unregister {
  const unregisters: Unregister[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;

  const markDirty = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      onDirty();
    }, DEBOUNCE_MS);
  };

  const worksheetEvents = [
    eventType('FilterChanged'),
    eventType('SummaryDataChanged'),
    eventType('MarkSelectionChanged'),
  ];

  for (const ws of dashboard.worksheets) {
    for (const evt of worksheetEvents) {
      try {
        unregisters.push(ws.addEventListener(evt, markDirty));
      } catch {
        // Event-Typ auf diesem Objekt nicht unterstützt (ältere Tableau-Version) — ignorieren.
      }
    }
  }

  // ParameterChanged wird auf dem jeweiligen Parameter-Objekt registriert.
  void dashboard
    .getParametersAsync()
    .then((params) => {
      for (const p of params) {
        try {
          const un = p.addEventListener?.(eventType('ParameterChanged'), markDirty);
          if (un) unregisters.push(un);
        } catch {
          // ignorieren
        }
      }
    })
    .catch(() => undefined);

  return () => {
    if (timer) clearTimeout(timer);
    for (const un of unregisters) {
      try {
        un();
      } catch {
        // ignorieren
      }
    }
  };
}
