import { describe, expect, it } from 'vitest';
import {
  CHAT_MODE_ORDER,
  ESTATE_SCOPE_ORDER,
  isInvestigateMode,
  modeLabelKey,
  nextChatMode,
  nextEstateScope,
  placeholderKeyForMode,
  scopeLabelKey,
} from '../src/chat/composer-mode';

/**
 * Reine Logik der Modus-Segmented-Control (W3 Untersuchungsmodus) — bewusst
 * ohne jsdom/Rendering, siehe Composer.tsx.
 */

describe('placeholderKeyForMode', () => {
  it('returns the investigate placeholder key for "investigate"', () => {
    expect(placeholderKeyForMode('investigate')).toBe('composer.placeholderInvestigate');
  });

  it('returns the default placeholder key for "ask"', () => {
    expect(placeholderKeyForMode('ask')).toBe('composer.placeholder');
  });

  it('returns the estate-scope placeholder key for "investigate-estate" (W7 Punkt 6)', () => {
    expect(placeholderKeyForMode('investigate-estate')).toBe('composer.placeholderInvestigateEstate');
  });
});

describe('modeLabelKey', () => {
  it('maps each mode to its own i18n key', () => {
    expect(modeLabelKey('ask')).toBe('composer.mode.ask');
    expect(modeLabelKey('investigate')).toBe('composer.mode.investigate');
  });

  it('treats "investigate-estate" as the Untersuchen label on the primary control', () => {
    expect(modeLabelKey('investigate-estate')).toBe('composer.mode.investigate');
  });
});

describe('isInvestigateMode (W7 Punkt 6: Umfangs-Umschalter)', () => {
  it('is true for both "investigate" and "investigate-estate", false for "ask"', () => {
    expect(isInvestigateMode('investigate')).toBe(true);
    expect(isInvestigateMode('investigate-estate')).toBe(true);
    expect(isInvestigateMode('ask')).toBe(false);
  });
});

describe('scopeLabelKey', () => {
  it('maps each scope to its own i18n key', () => {
    expect(scopeLabelKey('investigate')).toBe('composer.scope.dashboard');
    expect(scopeLabelKey('investigate-estate')).toBe('composer.scope.estate');
  });
});

describe('nextEstateScope', () => {
  it('toggles between the two scopes on ArrowRight/ArrowLeft/ArrowUp/ArrowDown', () => {
    expect(nextEstateScope('investigate', 'ArrowRight')).toBe('investigate-estate');
    expect(nextEstateScope('investigate', 'ArrowDown')).toBe('investigate-estate');
    expect(nextEstateScope('investigate-estate', 'ArrowLeft')).toBe('investigate');
    expect(nextEstateScope('investigate-estate', 'ArrowUp')).toBe('investigate');
  });

  it('jumps to the first/last scope on Home/End', () => {
    expect(nextEstateScope('investigate-estate', 'Home')).toBe(ESTATE_SCOPE_ORDER[0]);
    expect(nextEstateScope('investigate', 'End')).toBe(ESTATE_SCOPE_ORDER[ESTATE_SCOPE_ORDER.length - 1]);
  });

  it('returns null for keys that do not change the selection', () => {
    expect(nextEstateScope('investigate', 'Enter')).toBeNull();
    expect(nextEstateScope('investigate', 'a')).toBeNull();
  });

  it('treats "ask" as the dashboard scope (defensive default, the control is hidden in that mode)', () => {
    expect(nextEstateScope('ask', 'ArrowRight')).toBe('investigate-estate');
  });
});

describe('nextChatMode', () => {
  it('toggles between the two modes on ArrowRight/ArrowLeft/ArrowUp/ArrowDown', () => {
    expect(nextChatMode('ask', 'ArrowRight')).toBe('investigate');
    expect(nextChatMode('ask', 'ArrowDown')).toBe('investigate');
    expect(nextChatMode('investigate', 'ArrowLeft')).toBe('ask');
    expect(nextChatMode('investigate', 'ArrowUp')).toBe('ask');
  });

  it('jumps to the first/last mode on Home/End', () => {
    expect(nextChatMode('investigate', 'Home')).toBe(CHAT_MODE_ORDER[0]);
    expect(nextChatMode('ask', 'End')).toBe(CHAT_MODE_ORDER[CHAT_MODE_ORDER.length - 1]);
  });

  it('returns null for keys that do not change the selection', () => {
    expect(nextChatMode('ask', 'Enter')).toBeNull();
    expect(nextChatMode('ask', 'a')).toBeNull();
  });

  it('treats "investigate-estate" as "investigate" on the primary control (W7 Punkt 6)', () => {
    expect(nextChatMode('investigate-estate', 'ArrowRight')).toBe('ask');
    expect(nextChatMode('investigate-estate', 'Home')).toBe(CHAT_MODE_ORDER[0]);
  });
});
