import { DEFAULT_SLASH_COMMANDS } from '@openvizpilot/shared';
import { describe, expect, it } from 'vitest';
import { expandSlashCommand, matchSlashCommands } from '../src/chat/slash-commands';

describe('matchSlashCommands', () => {
  it('lists all commands for a bare slash', () => {
    expect(matchSlashCommands(DEFAULT_SLASH_COMMANDS, '/')).toHaveLength(DEFAULT_SLASH_COMMANDS.length);
  });

  it('filters by typed prefix', () => {
    const matches = matchSlashCommands(DEFAULT_SLASH_COMMANDS, '/ver');
    expect(matches.map((c) => c.name)).toEqual(['vergleich']);
  });

  it('returns nothing without a leading slash', () => {
    expect(matchSlashCommands(DEFAULT_SLASH_COMMANDS, 'vergleich')).toHaveLength(0);
  });

  it('returns nothing for an empty command list', () => {
    expect(matchSlashCommands([], '/')).toHaveLength(0);
  });
});

describe('expandSlashCommand', () => {
  it('expands a command with arguments into the playbook prompt', () => {
    const result = expandSlashCommand(DEFAULT_SLASH_COMMANDS, '/vergleich Nord Süd');
    expect(result?.display).toBe('/vergleich Nord Süd');
    expect(result?.name).toBe('vergleich');
    expect(result?.prompt).toContain('Vergleich von Nord Süd');
    expect(result?.prompt).toContain('aggregate_summary_data');
    expect(result?.prompt).not.toContain('{{args}}');
  });

  it('fills a neutral placeholder when arguments are missing', () => {
    const result = expandSlashCommand(DEFAULT_SLASH_COMMANDS, '/vergleich');
    expect(result?.prompt).toContain('den relevanten Vergleichsgruppen');
  });

  it('expands argument-free commands', () => {
    const result = expandSlashCommand(DEFAULT_SLASH_COMMANDS, '/zusammenfassung');
    expect(result?.display).toBe('/zusammenfassung');
    expect(result?.name).toBe('zusammenfassung');
    expect(result?.prompt).toContain('Management-Zusammenfassung');
  });

  it('returns null for unknown commands and plain text', () => {
    expect(expandSlashCommand(DEFAULT_SLASH_COMMANDS, '/gibtsnicht foo')).toBeNull();
    expect(expandSlashCommand(DEFAULT_SLASH_COMMANDS, 'Welche Filter sind aktiv?')).toBeNull();
  });

  it('returns null for a known name against an empty command list', () => {
    expect(expandSlashCommand([], '/vergleich')).toBeNull();
  });

  it('every command template is free of unresolved placeholders after expansion', () => {
    for (const c of DEFAULT_SLASH_COMMANDS) {
      const result = expandSlashCommand(DEFAULT_SLASH_COMMANDS, `/${c.name} X Y`);
      expect(result, c.name).not.toBeNull();
      expect(result?.prompt).not.toContain('{{');
    }
  });
});
