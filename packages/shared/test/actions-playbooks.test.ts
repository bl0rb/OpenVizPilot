import { describe, expect, it } from 'vitest';
import {
  dashboardPlaybookSchema,
  DEFAULT_SLASH_COMMANDS,
  describeAction,
  extractSuggestions,
  mergeCommands,
  playbookEntrySchema,
} from '../src';

describe('select_marks / activate_sheet suggestions', () => {
  it('parses both new action types from a trailing suggestions block', () => {
    const text = `Antwort.\n<suggestions>${JSON.stringify({
      followups: [],
      actions: [
        { type: 'select_marks', worksheet: 'Umsatz', field: 'Region', values: ['Nord', 'Süd'], label: 'Top-Regionen zeigen' },
        { type: 'activate_sheet', sheet: 'Details', label: 'Zu den Details' },
      ],
    })}</suggestions>`;
    const { suggestions } = extractSuggestions(text);
    expect(suggestions?.actions).toHaveLength(2);
    expect(suggestions?.actions[0]?.type).toBe('select_marks');
    expect(suggestions?.actions[1]?.type).toBe('activate_sheet');
  });

  it('describes the actions in plain text (always shown next to the label)', () => {
    expect(
      describeAction({ type: 'select_marks', worksheet: 'Umsatz', field: 'Region', values: ['Nord', 'Süd'], label: 'x' }),
    ).toBe('Markiere „Region" = Nord, Süd · Worksheet „Umsatz"');
    expect(describeAction({ type: 'activate_sheet', sheet: 'Details', label: 'x' })).toBe('Wechsle zu Sheet „Details"');
  });

  it('rejects malformed variants (missing values / empty sheet)', () => {
    const bad = `x\n<suggestions>${JSON.stringify({
      actions: [{ type: 'select_marks', worksheet: 'Umsatz', field: 'Region', values: [], label: 'x' }],
    })}</suggestions>`;
    expect(extractSuggestions(bad).suggestions).toBeNull();
    const bad2 = `x\n<suggestions>${JSON.stringify({ actions: [{ type: 'activate_sheet', sheet: '', label: 'x' }] })}</suggestions>`;
    expect(extractSuggestions(bad2).suggestions).toBeNull();
  });
});

describe('dashboard playbooks', () => {
  const cmd = (name: string) => ({ name, description: 'd', template: 'Ziel: etwas ausführliches tun' });

  it('validates starters (max 5) and commands', () => {
    expect(dashboardPlaybookSchema.safeParse({ starters: ['a'], commands: [cmd('x')] }).success).toBe(true);
    expect(dashboardPlaybookSchema.safeParse({ starters: ['1', '2', '3', '4', '5', '6'], commands: [] }).success).toBe(false);
    expect(dashboardPlaybookSchema.safeParse({ starters: [''], commands: [] }).success).toBe(false);
    expect(dashboardPlaybookSchema.safeParse({ starters: [], commands: [{ name: 'Böse Name' }] }).success).toBe(false);
    expect(playbookEntrySchema.safeParse({ dashboardKey: '', playbook: { starters: [], commands: [] } }).success).toBe(false);
  });

  it('merges dashboard commands over global ones by name and caps the list', () => {
    const merged = mergeCommands(DEFAULT_SLASH_COMMANDS, [cmd('zusammenfassung'), cmd('quartal')]);
    expect(merged[0]?.name).toBe('zusammenfassung');
    expect(merged[0]?.description).toBe('d'); // Dashboard-Variante gewinnt
    expect(merged[1]?.name).toBe('quartal');
    expect(merged.filter((c) => c.name === 'zusammenfassung')).toHaveLength(1);
    expect(merged.length).toBe(DEFAULT_SLASH_COMMANDS.length + 1);
    const many = Array.from({ length: 25 }, (_, i) => cmd(`c${i}`));
    expect(mergeCommands(many, [cmd('x')]).length).toBeLessThanOrEqual(20);
  });
});
