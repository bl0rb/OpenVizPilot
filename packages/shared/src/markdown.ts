export interface MarkdownTableOptions {
  /** Maximal ausgegebene Zeilen; darüber wird gekürzt und eine Fußnote angehängt. */
  maxRows?: number;
  /** Maximale Zeichen pro Zelle (danach Ellipse). */
  maxCellChars?: number;
}

const DEFAULT_MAX_ROWS = 1000;
const DEFAULT_MAX_CELL_CHARS = 200;

/**
 * Macht einen Wert sicher für eine Markdown-Tabellenzelle.
 * Neutralisiert neben Pipes auch Markdown-Link-/Bild-Syntax ([, ], `):
 * Zellwerte sind untrusted und dürfen im gerenderten LLM-Output keine
 * auto-ladenden Bilder/Links formen können (Exfiltrations-Beacons).
 */
export function escapeCell(value: string, maxCellChars: number = DEFAULT_MAX_CELL_CHARS): string {
  let v = value
    .replace(/\r?\n/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/`/g, '\\`')
    .trim();
  if (v.length > maxCellChars) {
    v = `${v.slice(0, Math.max(0, maxCellChars - 1))}…`;
  }
  return v;
}

/**
 * Rendert Zeilen als Markdown-Tabelle. Kürzt Zeilen auf maxRows (mit Fußnote)
 * und Zellen auf maxCellChars. Leere Eingabe ergibt einen expliziten Hinweis
 * statt einer leeren Tabelle.
 */
export function rowsToMarkdownTable(
  headers: string[],
  rows: string[][],
  opts: MarkdownTableOptions = {},
): string {
  const maxRows = opts.maxRows ?? DEFAULT_MAX_ROWS;
  const maxCellChars = opts.maxCellChars ?? DEFAULT_MAX_CELL_CHARS;

  if (headers.length === 0) {
    return '_(keine Spalten)_';
  }

  const headerLine = `| ${headers.map((h) => escapeCell(h, maxCellChars)).join(' | ')} |`;
  const separator = `| ${headers.map(() => '---').join(' | ')} |`;

  if (rows.length === 0) {
    return `${headerLine}\n${separator}\n_(keine Zeilen)_`;
  }

  const shown = rows.slice(0, maxRows);
  const lines = shown.map(
    (row) => `| ${headers.map((_, i) => escapeCell(row[i] ?? '', maxCellChars)).join(' | ')} |`,
  );

  let out = [headerLine, separator, ...lines].join('\n');
  if (rows.length > shown.length) {
    out += `\n\n_… ${rows.length - shown.length} weitere Zeilen nicht angezeigt._`;
  }
  return out;
}

/** Kürzt einen Text hart auf maxChars und hängt einen Hinweis an. */
export function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n\n_[Ausgabe gekürzt: ${text.length - maxChars} Zeichen entfernt]_`;
}
