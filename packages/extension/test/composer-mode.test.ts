import { describe, expect, it } from 'vitest';
import { CHAT_MODE_ORDER, modeLabelKey, nextChatMode, placeholderKeyForMode } from '../src/chat/composer-mode';

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
});

describe('modeLabelKey', () => {
  it('maps each mode to its own i18n key', () => {
    expect(modeLabelKey('ask')).toBe('composer.mode.ask');
    expect(modeLabelKey('investigate')).toBe('composer.mode.investigate');
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
});
