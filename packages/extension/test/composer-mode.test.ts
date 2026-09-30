import { describe, expect, it } from 'vitest';
import {
  isInvestigateMode,
  placeholderKeyForMode,
  toggleEstateScope,
  toggleInvestigate,
} from '../src/chat/composer-mode';

/**
 * Reine Logik der Modus-Schalter (W3 Untersuchungsmodus) — bewusst
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

describe('isInvestigateMode (W7 Punkt 6: Umfangs-Umschalter)', () => {
  it('is true for both "investigate" and "investigate-estate", false for "ask"', () => {
    expect(isInvestigateMode('investigate')).toBe(true);
    expect(isInvestigateMode('investigate-estate')).toBe(true);
    expect(isInvestigateMode('ask')).toBe(false);
  });
});

describe('toggleInvestigate', () => {
  it('switches Ask on to Investigate with the dashboard scope', () => {
    expect(toggleInvestigate('ask')).toBe('investigate');
  });

  it('switches both investigate scopes off to Ask', () => {
    expect(toggleInvestigate('investigate')).toBe('ask');
    expect(toggleInvestigate('investigate-estate')).toBe('ask');
  });
});

describe('toggleEstateScope', () => {
  it('flips between the dashboard and the estate scope', () => {
    expect(toggleEstateScope('investigate')).toBe('investigate-estate');
    expect(toggleEstateScope('investigate-estate')).toBe('investigate');
  });
});
