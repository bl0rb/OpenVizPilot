import { describe, expect, it } from 'vitest';
import { getCurrentLocale, normalizeLocale, setLocaleOverride, t } from '../src/i18n';

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

  it('prefers the language chosen in the extension over the browser language', () => {
    setLocaleOverride('de');
    expect(getCurrentLocale()).toBe('de');
    expect(t('settings.language')).toBe('Sprache');
    setLocaleOverride('en');
    expect(t('settings.language')).toBe('Language');
    setLocaleOverride(null);
  });
});
