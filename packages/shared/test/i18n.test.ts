import { describe, expect, it } from 'vitest';
import { normalizeLocale, t } from '../src/i18n';

describe('i18n helpers', () => {
  it('normalizes German and English locales', () => {
    expect(normalizeLocale('de-DE')).toBe('de');
    expect(normalizeLocale('en-US')).toBe('en');
    expect(normalizeLocale('fr-FR')).toBe('en');
  });

  it('returns translated strings for the requested locale', () => {
    expect(t('composer.placeholder', 'de')).toBe('Frage zum Dashboard… („/“ für Befehle)');
    expect(t('composer.placeholder', 'en')).toBe('Question about the dashboard… ("/" for commands)');
  });

  it('interpolates placeholders', () => {
    expect(t('app.starters.worksheet', 'de', { name: 'Revenue' })).toBe('Was zeigt „Revenue”?');
    expect(t('app.starters.worksheet', 'en', { name: 'Revenue' })).toBe('What does “Revenue” show?');
  });
});
