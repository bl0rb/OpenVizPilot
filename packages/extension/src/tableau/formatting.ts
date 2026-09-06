import { getTableau } from './api';

/**
 * Übernimmt Schrift und Textfarbe des Workbooks in das Chat-Panel, damit die
 * Extension nicht als einziges Objekt im Dashboard aus der Reihe fällt (typisch
 * bei Corporate-Themes mit eigener Hausschrift).
 *
 * Zwei bewusste Grenzen:
 *
 * 1. Tableau liefert über `workbookFormatting` NUR Schrift- und Textangaben,
 *    keine Hintergrundfarben. Das ist deshalb kein Dark-Mode.
 * 2. Genau daraus folgt die Falle: Ein dunkles Workbook-Theme hat eine HELLE
 *    Schriftfarbe. Würden wir die auf unseren weißen Panelhintergrund legen,
 *    wäre das Panel unlesbar. Deshalb wird die Textfarbe nur übernommen, wenn
 *    sie gegen Weiß ausreichend Kontrast hat; sonst bleibt es bei der eigenen.
 */

/** Nur diese Eigenschaften übernehmen wir — keine Ränder, keine Hintergründe. */
const FONT_PROPERTIES = ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle'] as const;

/** Mindestkontrast der übernommenen Textfarbe gegen den weißen Panelhintergrund. */
const MIN_CONTRAST_RATIO = 4.5;

type CssProperties = Record<string, string | number | undefined>;

interface AppliedFormatting {
  fontFamily?: string;
  fontSize?: string;
  fontWeight?: string;
  fontStyle?: string;
  color?: string;
  titleFontFamily?: string;
  titleFontWeight?: string;
  /** Warum eine angebotene Textfarbe verworfen wurde — für Tests und Diagnose. */
  rejectedColor?: string;
}

/** Alles, was diese Funktion vom Ziel braucht — hält sie ohne DOM testbar. */
export interface StyleTarget {
  style: {
    setProperty(name: string, value: string): void;
    removeProperty(name: string): void;
  };
}

/** Alle Variablen, die diese Funktion verwaltet — sie setzt oder entfernt sie, nie „teilweise". */
const MANAGED_VARS = [
  '--ovp-font-family',
  '--ovp-font-size',
  '--ovp-font-weight',
  '--ovp-font-style',
  '--ovp-color',
  '--ovp-title-font-family',
  '--ovp-title-font-weight',
] as const;

/**
 * Liest die Workbook-Formatierung und schreibt sie als CSS-Variablen an das
 * Wurzelelement. Läuft still ins Leere, wenn die Tableau-Version die API nicht
 * kennt oder kein Format gesetzt ist — der Aufrufer muss nichts prüfen.
 */
export function applyWorkbookFormatting(
  root: StyleTarget = document.documentElement,
  /**
   * Formatvorlagen aus dem `WorkbookFormattingChanged`-Event. Zwingend, wenn
   * nach einer Änderung neu gesetzt wird: `environment.workbookFormatting` ist
   * die Momentaufnahme vom Start und wird von Tableau nie aktualisiert.
   */
  sheetsOverride?: Array<{ classNameKey: string; cssProperties: CssProperties }>,
): AppliedFormatting {
  let sheets = sheetsOverride;
  if (!sheets) {
    try {
      sheets = getTableau().extensions.environment.workbookFormatting?.formattingSheets ?? [];
    } catch {
      // Außerhalb von Tableau (Mock, Storybook): nichts zu tun.
      return {};
    }
  }

  const worksheet = sheets.find((s) => s.classNameKey === 'tableau-worksheet')?.cssProperties;
  const title = sheets.find((s) => s.classNameKey === 'tableau-worksheet-title')?.cssProperties;
  const applied: AppliedFormatting = {};
  const vars = new Map<string, string>();

  for (const prop of FONT_PROPERTIES) {
    const value = cssValue(worksheet?.[prop]);
    if (value) {
      applied[prop] = value;
      vars.set(`--ovp-${kebab(prop)}`, value);
    }
  }

  const color = cssValue(worksheet?.color);
  if (color) {
    if (hasEnoughContrastOnWhite(color)) {
      applied.color = color;
      vars.set('--ovp-color', color);
    } else {
      // Helle Schrift auf unserem weißen Panel wäre unlesbar — verworfen.
      applied.rejectedColor = color;
    }
  }

  const titleFamily = cssValue(title?.fontFamily);
  if (titleFamily) {
    applied.titleFontFamily = titleFamily;
    vars.set('--ovp-title-font-family', titleFamily);
  }
  const titleWeight = cssValue(title?.fontWeight);
  if (titleWeight) {
    applied.titleFontWeight = titleWeight;
    vars.set('--ovp-title-font-weight', titleWeight);
  }

  // Immer den vollständigen Satz schreiben: Was diesmal fehlt, muss WEG, sonst
  // bliebe nach einer Formatänderung ein Rest des alten Formats stehen.
  for (const name of MANAGED_VARS) {
    const value = vars.get(name);
    if (value === undefined) root.style.removeProperty(name);
    else root.style.setProperty(name, value);
  }

  return applied;
}

function cssValue(value: string | number | undefined): string | undefined {
  if (value === undefined || value === null) return undefined;
  const text = String(value).trim();
  if (!text) return undefined;
  // Nur harmlose Werte: keine url(), kein expression(), keine Semikolons.
  if (/[;{}]|url\(|expression\(/i.test(text)) return undefined;
  return text.slice(0, 120);
}

function kebab(prop: string): string {
  return prop.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

/** Relative Luminanz nach WCAG; unbekannte Farbformate gelten als untauglich. */
function hasEnoughContrastOnWhite(color: string): boolean {
  const rgb = parseColor(color);
  if (!rgb) return false;
  const luminance =
    0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
  // Kontrast gegen Weiß (Luminanz 1.0).
  return (1.05) / (luminance + 0.05) >= MIN_CONTRAST_RATIO;
}

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/**
 * Halbtransparente Farben erscheinen auf unserem weißen Panel aufgehellt —
 * gemessen wird deshalb die Farbe, die der Anwender tatsächlich sieht.
 */
function overWhite([r, g, b]: [number, number, number], alpha: number): [number, number, number] {
  const mix = (c: number) => Math.round(alpha * c + (1 - alpha) * 255);
  return [mix(r), mix(g), mix(b)];
}

function parseColor(color: string): [number, number, number] | null {
  const hex = color.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex?.[1]) {
    const h = hex[1];
    const full = h.length === 3 ? h.replace(/./g, (c) => c + c) : h;
    return [
      parseInt(full.slice(0, 2), 16),
      parseInt(full.slice(2, 4), 16),
      parseInt(full.slice(4, 6), 16),
    ];
  }
  const rgb = color.trim().match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:[,/]\s*([\d.]+))?/i);
  if (rgb) {
    const base: [number, number, number] = [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
    const alpha = rgb[4] === undefined ? 1 : Number(rgb[4]);
    if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1) return null;
    return alpha === 1 ? base : overWhite(base, alpha);
  }
  return null;
}
