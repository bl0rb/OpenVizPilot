import { describe, expect, it } from 'vitest';
import { MAX_FOCUS_CHARS } from '@openvizpilot/shared';
import {
  addStandardQuestion,
  dashboardPrefsSchema,
  MAX_QUESTION_CHARS,
  MAX_STANDARD_QUESTIONS,
} from '../server/src/personalization-schema';

describe('dashboardPrefsSchema', () => {
  it('accepts an empty focus and no questions', () => {
    expect(dashboardPrefsSchema.safeParse({ focus: '', questions: [] }).success).toBe(true);
  });

  it('accepts exactly MAX_STANDARD_QUESTIONS questions', () => {
    const questions = Array.from({ length: MAX_STANDARD_QUESTIONS }, (_, i) => `Frage ${i}`);
    expect(dashboardPrefsSchema.safeParse({ focus: '', questions }).success).toBe(true);
  });

  it('rejects more than MAX_STANDARD_QUESTIONS questions', () => {
    const questions = Array.from({ length: MAX_STANDARD_QUESTIONS + 1 }, (_, i) => `Frage ${i}`);
    expect(dashboardPrefsSchema.safeParse({ focus: '', questions }).success).toBe(false);
  });

  it('rejects a focus over MAX_FOCUS_CHARS', () => {
    const result = dashboardPrefsSchema.safeParse({ focus: 'x'.repeat(MAX_FOCUS_CHARS + 1), questions: [] });
    expect(result.success).toBe(false);
  });

  it('accepts a focus at exactly MAX_FOCUS_CHARS', () => {
    const result = dashboardPrefsSchema.safeParse({ focus: 'x'.repeat(MAX_FOCUS_CHARS), questions: [] });
    expect(result.success).toBe(true);
  });

  it('rejects empty question strings', () => {
    expect(dashboardPrefsSchema.safeParse({ focus: '', questions: [''] }).success).toBe(false);
  });

  it('rejects a missing questions field', () => {
    expect(dashboardPrefsSchema.safeParse({ focus: '' }).success).toBe(false);
  });
});

describe('addStandardQuestion', () => {
  const empty = { focus: '', questions: [] as string[] };

  it('adds a question and reports it', () => {
    const result = addStandardQuestion(empty, 'Wie lief Q3?');
    expect(result.prefs?.questions).toEqual(['Wie lief Q3?']);
    expect(result.notice).toMatch(/gespeichert/);
  });

  it('refuses a duplicate without changing anything', () => {
    const result = addStandardQuestion({ focus: '', questions: ['Wie lief Q3?'] }, 'Wie lief Q3?');
    expect(result.prefs).toBeUndefined();
    expect(result.notice).toMatch(/schon/);
  });

  it('refuses more than the maximum', () => {
    const full = { focus: '', questions: Array.from({ length: MAX_STANDARD_QUESTIONS }, (_, i) => `F${i}`) };
    const result = addStandardQuestion(full, 'Noch eine?');
    expect(result.prefs).toBeUndefined();
    expect(result.notice).toContain(String(MAX_STANDARD_QUESTIONS));
  });

  it('truncates an over-long question to the schema limit', () => {
    const result = addStandardQuestion(empty, 'x'.repeat(MAX_QUESTION_CHARS + 50));
    expect(result.prefs?.questions[0]).toHaveLength(MAX_QUESTION_CHARS);
    expect(dashboardPrefsSchema.safeParse(result.prefs).success).toBe(true);
  });
});
