import { z } from 'zod';

/**
 * Strukturierte Vorschläge am Ende einer abschließenden LLM-Antwort:
 * Anschlussfragen (followups) und Dashboard-Aktionen (actions).
 *
 * SICHERHEITSMODELL: Aktionen sind reine VORSCHLÄGE. Die Extension führt sie
 * ausschließlich nach einem expliziten Klick des Users aus (Human-in-the-Loop)
 * — nie automatisch aus einem Tool-Call oder beim Rendern. Der Chip zeigt
 * neben dem LLM-Label immer den technischen Klartext der Aktion, damit ein
 * irreführendes Label die Aktion nicht verschleiern kann.
 */

export const MAX_FOLLOWUPS = 3;
export const MAX_ACTIONS = 3;

const label = z.string().min(1).max(80);

const applyFilterAction = z.object({
  type: z.literal('apply_filter'),
  worksheet: z.string().min(1).max(200),
  field: z.string().min(1).max(200),
  values: z.array(z.string().min(1).max(120)).min(1).max(10),
  label,
});

const clearFilterAction = z.object({
  type: z.literal('clear_filter'),
  worksheet: z.string().min(1).max(200),
  field: z.string().min(1).max(200),
  label,
});

const setParameterAction = z.object({
  type: z.literal('set_parameter'),
  parameter: z.string().min(1).max(200),
  value: z.string().min(1).max(120),
  label,
});

/** Markierungen setzen: hebt Marks mit den Werten im Feld hervor (ersetzt die Auswahl). */
const selectMarksAction = z.object({
  type: z.literal('select_marks'),
  worksheet: z.string().min(1).max(200),
  field: z.string().min(1).max(200),
  values: z.array(z.string().min(1).max(120)).min(1).max(10),
  label,
});

/** Sheet-Navigation: aktiviert ein Worksheet/Dashboard des Workbooks. */
const activateSheetAction = z.object({
  type: z.literal('activate_sheet'),
  sheet: z.string().min(1).max(200),
  label,
});

export const dashboardActionSchema = z.discriminatedUnion('type', [
  applyFilterAction,
  clearFilterAction,
  setParameterAction,
  selectMarksAction,
  activateSheetAction,
]);

export type DashboardAction = z.infer<typeof dashboardActionSchema>;

// Bewusst großzügige Obergrenzen beim Parsen; normalize() kappt auf MAX_*.
const suggestionsSchema = z.object({
  followups: z.array(z.string().min(1).max(160)).max(10).optional(),
  actions: z.array(dashboardActionSchema).max(10).optional(),
});

export interface Suggestions {
  followups: string[];
  actions: DashboardAction[];
}

/** Menschenlesbarer Klartext einer Aktion — wird im Chip immer mit angezeigt. */
export function describeAction(action: DashboardAction): string {
  switch (action.type) {
    case 'apply_filter':
      return `Filter „${action.field}" = ${action.values.join(', ')} · Worksheet „${action.worksheet}"`;
    case 'clear_filter':
      return `Filter „${action.field}" zurücksetzen · Worksheet „${action.worksheet}"`;
    case 'set_parameter':
      return `Parameter „${action.parameter}" = ${action.value}`;
    case 'select_marks':
      return `Markiere „${action.field}" = ${action.values.join(', ')} · Worksheet „${action.worksheet}"`;
    case 'activate_sheet':
      return `Wechsle zu Sheet „${action.sheet}"`;
  }
}

const OPEN_TAG = '<suggestions>';
const CLOSE_TAG = '</suggestions>';
const TRAILING_BLOCK_RE = /^<suggestions>\s*([\s\S]*?)\s*<\/suggestions>\s*$/;

/**
 * Extrahiert den <suggestions>-Block aus einer Antwort.
 *
 * Vertrauensmodell: Nur ein Block, der die Antwort ABSCHLIESST, gilt als
 * echter Modell-Output. Ein Block mitten im Text (z. B. weil das Modell einen
 * in Dashboard-Zellen injizierten Block wörtlich zitiert) wird NIE als
 * Aktionsquelle geparst; existiert mehr als ein Block, werden gar keine
 * Vorschläge übernommen. Ein am Antwort-Ende abgeschnittener Block
 * (finishReason "length") wird entfernt, damit kein rohes JSON im Chat und
 * in der Historie landet.
 */
export function extractSuggestions(text: string): { text: string; suggestions: Suggestions | null } {
  const start = text.lastIndexOf(OPEN_TAG);
  if (start < 0) {
    return { text, suggestions: null };
  }

  const tail = text.slice(start);
  const match = TRAILING_BLOCK_RE.exec(tail);
  if (!match) {
    if (!tail.includes(CLOSE_TAG)) {
      // Abgeschnittener Block am Antwort-Ende (z. B. Längenlimit): wegschneiden.
      return { text: text.slice(0, start).trim(), suggestions: null };
    }
    // Block ist nicht das Antwort-Ende → zitierte DATEN, unverändert lassen.
    return { text, suggestions: null };
  }

  const stripped = text.slice(0, start).trim();

  if (text.indexOf(OPEN_TAG) !== start) {
    // Mehr als ein Block: mindestens einer stammt aus zitierten Daten —
    // nichts davon ist vertrauenswürdig, keine Chips.
    return { text: stripped, suggestions: null };
  }

  let suggestions: Suggestions | null = null;
  try {
    const raw = (match[1] ?? '').replace(/```(?:json)?/gi, '').trim();
    const parsed = suggestionsSchema.safeParse(JSON.parse(raw));
    if (parsed.success) {
      const followups = (parsed.data.followups ?? []).slice(0, MAX_FOLLOWUPS);
      const actions = (parsed.data.actions ?? []).slice(0, MAX_ACTIONS);
      if (followups.length > 0 || actions.length > 0) {
        suggestions = { followups, actions };
      }
    }
  } catch {
    // Block war kein valides JSON — Text bleibt bereinigt, keine Chips.
  }
  return { text: stripped, suggestions };
}
