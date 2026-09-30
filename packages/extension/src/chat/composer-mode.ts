import type { ChatMode } from '@openvizpilot/shared';

/**
 * Reine Logik der Modus-Schalter im Composer (W3 Untersuchungsmodus)
 * — bewusst ohne Preact/DOM-Bezug, damit sie ohne jsdom testbar bleibt.
 */

/** true für 'investigate' UND 'investigate-estate' — beide zeigen die Untersuchen-Ansicht (Plan, mehr Schritte, Fazit). */
export function isInvestigateMode(mode: ChatMode): boolean {
  return mode === 'investigate' || mode === 'investigate-estate';
}

/** i18n-Key für den Platzhaltertext im Eingabefeld, abhängig vom Modus. */
export function placeholderKeyForMode(mode: ChatMode): string {
  if (mode === 'investigate-estate') return 'composer.placeholderInvestigateEstate';
  if (mode === 'investigate') return 'composer.placeholderInvestigate';
  return 'composer.placeholder';
}

/** Kippschalter "Untersuchen": an → 'investigate' (Umfang Dashboard), aus → 'ask'. */
export function toggleInvestigate(mode: ChatMode): ChatMode {
  return isInvestigateMode(mode) ? 'ask' : 'investigate';
}

/**
 * Kippschalter "Gesamte Tableau-Umgebung" (W7 Punkt 6): aus = "Nur dieses
 * Dashboard". Nur sichtbar, wenn der primäre Modus Untersuchen ist (siehe
 * isInvestigateMode) UND features.serverData lizenziert/freigegeben ist.
 * Beide Werte sind reguläre ChatMode-Werte (der Umfang ist der Modus, den der
 * Server sieht).
 */
export function toggleEstateScope(mode: ChatMode): ChatMode {
  return mode === 'investigate-estate' ? 'investigate' : 'investigate-estate';
}
