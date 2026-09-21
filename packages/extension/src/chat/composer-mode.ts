import type { ChatMode } from '@openvizpilot/shared';

/**
 * Reine Logik der Modus-Segmented-Control im Composer (W3 Untersuchungsmodus)
 * — bewusst ohne Preact/DOM-Bezug, damit sie ohne jsdom testbar bleibt.
 */

export const CHAT_MODE_ORDER: readonly ChatMode[] = ['ask', 'investigate'];

/**
 * Untersuchen-Umfang (W7 Punkt 6): "Nur dieses Dashboard" vs. "Gesamte
 * Tableau-Umgebung" — ein zweiter Umschalter, der nur sichtbar ist, wenn der
 * primäre Modus Untersuchen ist (siehe isInvestigateMode) UND
 * features.serverData lizenziert/freigegeben ist. Beide Werte sind reguläre
 * ChatMode-Werte (der Umfang ist der Modus, den der Server sieht).
 */
export const ESTATE_SCOPE_ORDER: readonly ChatMode[] = ['investigate', 'investigate-estate'];

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

/** i18n-Key für das Label der primären Segmented-Control-Option (Fragen/Untersuchen). */
export function modeLabelKey(mode: ChatMode): string {
  return isInvestigateMode(mode) ? 'composer.mode.investigate' : 'composer.mode.ask';
}

/** i18n-Key für das Label des Umfangs-Umschalters (W7 Punkt 6). */
export function scopeLabelKey(scope: ChatMode): string {
  return scope === 'investigate-estate' ? 'composer.scope.estate' : 'composer.scope.dashboard';
}

function cycleOrder<T>(order: readonly T[], current: T, key: string): T | null {
  const idx = order.indexOf(current);
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return order[(idx + 1) % order.length]!;
    case 'ArrowLeft':
    case 'ArrowUp':
      return order[(idx - 1 + order.length) % order.length]!;
    case 'Home':
      return order[0]!;
    case 'End':
      return order[order.length - 1]!;
    default:
      return null;
  }
}

/**
 * Tastaturnavigation für die primäre Segmented-Control (role="radiogroup"):
 * Pfeiltasten wechseln zwischen den beiden Modi, Home/End springen an den
 * Anfang/Ende. Gibt null zurück, wenn die Taste die Auswahl nicht ändert
 * (dann soll der Aufrufer die Taste nicht abfangen). Ein aktiver
 * Umgebungs-Umfang ('investigate-estate') zählt dabei als 'investigate'.
 */
export function nextChatMode(current: ChatMode, key: string): ChatMode | null {
  const base: ChatMode = current === 'investigate-estate' ? 'investigate' : current;
  return cycleOrder(CHAT_MODE_ORDER, base, key);
}

/** Tastaturnavigation für den Umfangs-Umschalter (W7 Punkt 6) — analog zu nextChatMode. */
export function nextEstateScope(current: ChatMode, key: string): ChatMode | null {
  const base: ChatMode = current === 'investigate-estate' ? 'investigate-estate' : 'investigate';
  return cycleOrder(ESTATE_SCOPE_ORDER, base, key);
}
