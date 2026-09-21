import type { ChatMode } from '@openvizpilot/shared';

/**
 * Reine Logik der Modus-Segmented-Control im Composer (W3 Untersuchungsmodus)
 * — bewusst ohne Preact/DOM-Bezug, damit sie ohne jsdom testbar bleibt.
 */

export const CHAT_MODE_ORDER: readonly ChatMode[] = ['ask', 'investigate'];

/** i18n-Key für den Platzhaltertext im Eingabefeld, abhängig vom Modus. */
export function placeholderKeyForMode(mode: ChatMode): string {
  return mode === 'investigate' ? 'composer.placeholderInvestigate' : 'composer.placeholder';
}

/** i18n-Key für das Label der Segmented-Control-Option eines Modus. */
export function modeLabelKey(mode: ChatMode): string {
  return mode === 'investigate' ? 'composer.mode.investigate' : 'composer.mode.ask';
}

/**
 * Tastaturnavigation für die Segmented-Control (role="radiogroup"): Pfeiltasten
 * wechseln zwischen den beiden Modi, Home/End springen an den Anfang/Ende.
 * Gibt null zurück, wenn die Taste die Auswahl nicht ändert (dann soll der
 * Aufrufer die Taste nicht abfangen).
 */
export function nextChatMode(current: ChatMode, key: string): ChatMode | null {
  const idx = CHAT_MODE_ORDER.indexOf(current);
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return CHAT_MODE_ORDER[(idx + 1) % CHAT_MODE_ORDER.length]!;
    case 'ArrowLeft':
    case 'ArrowUp':
      return CHAT_MODE_ORDER[(idx - 1 + CHAT_MODE_ORDER.length) % CHAT_MODE_ORDER.length]!;
    case 'Home':
      return CHAT_MODE_ORDER[0]!;
    case 'End':
      return CHAT_MODE_ORDER[CHAT_MODE_ORDER.length - 1]!;
    default:
      return null;
  }
}
