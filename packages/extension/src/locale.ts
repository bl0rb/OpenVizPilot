import { setLocaleOverride, type SupportedLocale } from '@openvizpilot/shared';

/**
 * Sprache der Extension — persönliche Wahl je Browser (localStorage), nicht im
 * Workbook: Tableau meldet als Browsersprache fast immer Englisch, deshalb fragt
 * die Extension beim ersten Start und merkt sich die Antwort.
 */
export const LOCALE_STORAGE_KEY = 'tableauChat.locale';

/** Gespeicherte Sprache oder null (noch nie gewählt bzw. Storage nicht verfügbar). */
export function loadStoredLocale(storage: Pick<Storage, 'getItem'> | null = safeStorage()): SupportedLocale | null {
  try {
    const value = storage?.getItem(LOCALE_STORAGE_KEY);
    return value === 'de' || value === 'en' ? value : null;
  } catch {
    return null;
  }
}

/** Sprache merken und sofort für alle t()-Aufrufe setzen. */
export function chooseLocale(locale: SupportedLocale, storage: Pick<Storage, 'setItem'> | null = safeStorage()): void {
  try {
    storage?.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Storage nicht verfügbar — die Wahl gilt dann nur für diese Sitzung.
  }
  applyLocale(locale);
}

export function applyLocale(locale: SupportedLocale): void {
  setLocaleOverride(locale);
  if (typeof document !== 'undefined') document.documentElement.lang = locale;
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
