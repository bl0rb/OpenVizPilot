import { MAX_FOCUS_CHARS } from '@openvizpilot/shared';
import { z } from 'zod';

/**
 * Datenvertrag der Enterprise-Personalisierung: Antwortfokus und die selbst
 * gespeicherten Standardfragen eines Nutzers je Dashboard. Liegt hier und
 * nicht in @openvizpilot/shared, weil es die Fachlichkeit der lizenzpflichtigen
 * Funktion beschreibt — Server (Routen, Speicher) und Extension (Panels)
 * greifen beide darauf zu.
 */

export const MAX_STANDARD_QUESTIONS = 5;
export const MAX_QUESTION_CHARS = 200;

export const dashboardPrefsSchema = z.object({
  /** Freitext-Antwortfokus des Users für dieses Dashboard; '' = kein Fokus gewählt. */
  // Dieselbe Grenze wie das Feld `answerFocus` der Chat-Anfrage (shared/schemas.ts).
  focus: z.string().max(MAX_FOCUS_CHARS),
  /** Vom User gespeicherte Standardfragen (Start-Chips), höchstens MAX_STANDARD_QUESTIONS. */
  questions: z.array(z.string().min(1).max(MAX_QUESTION_CHARS)).max(MAX_STANDARD_QUESTIONS),
});

export type DashboardPrefs = z.infer<typeof dashboardPrefsSchema>;

/** Vorgefertigte Fokus-Optionen für das Onboarding und das Einstellungen-Panel. */
export const FOCUS_PRESETS: string[] = [
  'Management-Kurzfassung: die wichtigsten Aussagen in 3–5 Sätzen',
  'Detaillierte Analyse: Zahlen einordnen, Auffälligkeiten erklären',
  'Kompakte Tabellen: Kennzahlen strukturiert, wenig Fließtext',
  'Handlungsempfehlungen: was sollte ich als Nächstes tun?',
];

/**
 * Ergebnis von `addStandardQuestion` — der Kern zeigt `notice` an und speichert
 * `prefs`, falls gesetzt. Die Regeln (Duplikat, Höchstzahl, Kürzung) gehören
 * zur lizenzpflichtigen Funktion und stehen deshalb hier.
 */
export interface AddStandardQuestionResult {
  prefs?: DashboardPrefs;
  notice: string;
}

export function addStandardQuestion(current: DashboardPrefs, text: string): AddStandardQuestionResult {
  const question = text.slice(0, MAX_QUESTION_CHARS);
  if (current.questions.includes(question)) {
    return { notice: 'Diese Frage ist schon als Standardfrage gespeichert.' };
  }
  if (current.questions.length >= MAX_STANDARD_QUESTIONS) {
    return {
      notice: `Maximal ${MAX_STANDARD_QUESTIONS} Standardfragen pro Dashboard — lösche zuerst eine in den Einstellungen.`,
    };
  }
  return { prefs: { ...current, questions: [...current.questions, question] }, notice: 'Als Standardfrage gespeichert.' };
}
