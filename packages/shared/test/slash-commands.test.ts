import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SLASH_COMMANDS,
  MAX_SLASH_COMMANDS,
  MAX_SLASH_COMMAND_TEMPLATE_CHARS,
  MIN_SLASH_COMMAND_TEMPLATE_CHARS,
  slashCommandListSchema,
  slashCommandSchema,
} from '../src/slash-commands';

const valid = { name: 'test', description: 'Testbefehl', template: 'x'.repeat(20) };

describe('slashCommandSchema', () => {
  it('accepts a minimal valid command', () => {
    expect(slashCommandSchema.safeParse(valid).success).toBe(true);
  });

  it('accepts an optional argHint', () => {
    expect(slashCommandSchema.safeParse({ ...valid, argHint: '<A> <B>' }).success).toBe(true);
  });

  it('rejects names with uppercase letters or spaces', () => {
    expect(slashCommandSchema.safeParse({ ...valid, name: 'Test' }).success).toBe(false);
    expect(slashCommandSchema.safeParse({ ...valid, name: 'test befehl' }).success).toBe(false);
  });

  it('rejects a name over 32 chars', () => {
    expect(slashCommandSchema.safeParse({ ...valid, name: 'a'.repeat(33) }).success).toBe(false);
  });

  it('rejects a description over 80 chars', () => {
    expect(slashCommandSchema.safeParse({ ...valid, description: 'x'.repeat(81) }).success).toBe(false);
  });

  it('rejects a template below the minimum length', () => {
    expect(
      slashCommandSchema.safeParse({ ...valid, template: 'x'.repeat(MIN_SLASH_COMMAND_TEMPLATE_CHARS - 1) })
        .success,
    ).toBe(false);
  });

  it('accepts a template at exactly the maximum length', () => {
    expect(
      slashCommandSchema.safeParse({ ...valid, template: 'x'.repeat(MAX_SLASH_COMMAND_TEMPLATE_CHARS) }).success,
    ).toBe(true);
  });

  it('rejects a template over the maximum length', () => {
    expect(
      slashCommandSchema.safeParse({ ...valid, template: 'x'.repeat(MAX_SLASH_COMMAND_TEMPLATE_CHARS + 1) })
        .success,
    ).toBe(false);
  });
});

describe('slashCommandListSchema', () => {
  it('accepts the built-in defaults', () => {
    expect(slashCommandListSchema.safeParse(DEFAULT_SLASH_COMMANDS).success).toBe(true);
  });

  it('accepts an empty list', () => {
    expect(slashCommandListSchema.safeParse([]).success).toBe(true);
  });

  it('accepts exactly MAX_SLASH_COMMANDS entries', () => {
    const commands = Array.from({ length: MAX_SLASH_COMMANDS }, (_, i) => ({ ...valid, name: `cmd-${i}` }));
    expect(slashCommandListSchema.safeParse(commands).success).toBe(true);
  });

  it('rejects more than MAX_SLASH_COMMANDS entries', () => {
    const commands = Array.from({ length: MAX_SLASH_COMMANDS + 1 }, (_, i) => ({ ...valid, name: `cmd-${i}` }));
    expect(slashCommandListSchema.safeParse(commands).success).toBe(false);
  });

  it('rejects duplicate names', () => {
    const result = slashCommandListSchema.safeParse([valid, valid]);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.message.includes('Doppelter Befehlsname'))).toBe(true);
    }
  });
});
