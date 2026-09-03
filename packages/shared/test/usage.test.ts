import { describe, expect, it } from 'vitest';
import { MAX_USAGE_EVENTS_PER_REQUEST, MAX_USAGE_KEY_CHARS, usageEventsRequestSchema } from '../src/usage';

describe('usageEventsRequestSchema', () => {
  it('accepts an empty event list', () => {
    expect(usageEventsRequestSchema.safeParse({ events: [] }).success).toBe(true);
  });

  it('accepts events with whitelisted metrics', () => {
    const result = usageEventsRequestSchema.safeParse({
      events: [
        { metric: 'slash_command', key: 'vergleich' },
        { metric: 'action_executed', key: 'apply_filter' },
        { metric: 'standard_question_saved', key: 'saved' },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects a metric outside the whitelist', () => {
    const result = usageEventsRequestSchema.safeParse({ events: [{ metric: 'chat_turn', key: 'x' }] });
    expect(result.success).toBe(false);
  });

  it('rejects a key over MAX_USAGE_KEY_CHARS', () => {
    const result = usageEventsRequestSchema.safeParse({
      events: [{ metric: 'slash_command', key: 'x'.repeat(MAX_USAGE_KEY_CHARS + 1) }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects more than MAX_USAGE_EVENTS_PER_REQUEST events', () => {
    const events = Array.from({ length: MAX_USAGE_EVENTS_PER_REQUEST + 1 }, () => ({
      metric: 'slash_command' as const,
      key: 'x',
    }));
    expect(usageEventsRequestSchema.safeParse({ events }).success).toBe(false);
  });

  it('rejects an empty key', () => {
    const result = usageEventsRequestSchema.safeParse({ events: [{ metric: 'slash_command', key: '' }] });
    expect(result.success).toBe(false);
  });
});
