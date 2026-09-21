import { describe, expect, it } from 'vitest';
import {
  MAX_METRICS,
  MAX_METRIC_DEFINITION_CHARS,
  MAX_METRIC_SYNONYMS,
  MAX_METRIC_VERIFIED_QUESTIONS,
  METRIC_CATALOG_PROMPT_BUDGET_CHARS,
  metricCatalogSchema,
  metricSchema,
  renderMetricCatalogForPrompt,
  type Metric,
} from '../src/metrics';

const valid: Metric = {
  id: 'deckungsbeitrag-ii',
  name: 'Deckungsbeitrag II',
  synonyms: ['DB2', 'DB II', 'CM2'],
  definition: 'Umsatz − variable Kosten − Fixkosten',
  owner: 'Controlling',
  datasource: 'Finance Semantic Model',
  interpretation: 'Unter 18 % kritisch',
  verifiedQuestions: [{ question: 'Was ist DB2?', answerGuidance: 'Definition wörtlich wiedergeben.' }],
};

describe('metricSchema', () => {
  it('accepts a minimal valid metric', () => {
    expect(metricSchema.safeParse({ id: 'umsatz', name: 'Umsatz', synonyms: [], definition: 'Netto-Erlöse', verifiedQuestions: [] }).success).toBe(true);
  });

  it('accepts the fully populated example', () => {
    expect(metricSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects an id with uppercase letters, spaces or a leading digit', () => {
    expect(metricSchema.safeParse({ ...valid, id: 'Umsatz' }).success).toBe(false);
    expect(metricSchema.safeParse({ ...valid, id: 'umsatz eur' }).success).toBe(false);
    expect(metricSchema.safeParse({ ...valid, id: '1umsatz' }).success).toBe(false);
  });

  it('rejects an id over 40 chars', () => {
    expect(metricSchema.safeParse({ ...valid, id: 'a'.repeat(41) }).success).toBe(false);
    expect(metricSchema.safeParse({ ...valid, id: 'a' + 'a'.repeat(39) }).success).toBe(true);
  });

  it('rejects a definition over the maximum length', () => {
    expect(metricSchema.safeParse({ ...valid, definition: 'x'.repeat(MAX_METRIC_DEFINITION_CHARS + 1) }).success).toBe(false);
    expect(metricSchema.safeParse({ ...valid, definition: 'x'.repeat(MAX_METRIC_DEFINITION_CHARS) }).success).toBe(true);
  });

  it('rejects an empty definition', () => {
    expect(metricSchema.safeParse({ ...valid, definition: '' }).success).toBe(false);
  });

  it('rejects more than MAX_METRIC_SYNONYMS synonyms', () => {
    expect(metricSchema.safeParse({ ...valid, synonyms: Array.from({ length: MAX_METRIC_SYNONYMS + 1 }, (_, i) => 's' + i) }).success).toBe(false);
    expect(metricSchema.safeParse({ ...valid, synonyms: Array.from({ length: MAX_METRIC_SYNONYMS }, (_, i) => 's' + i) }).success).toBe(true);
  });

  it('rejects more than MAX_METRIC_VERIFIED_QUESTIONS verified questions', () => {
    const many = Array.from({ length: MAX_METRIC_VERIFIED_QUESTIONS + 1 }, () => ({ question: 'q', answerGuidance: 'a' }));
    expect(metricSchema.safeParse({ ...valid, verifiedQuestions: many }).success).toBe(false);
  });

  it('rejects a verified question missing answerGuidance', () => {
    expect(metricSchema.safeParse({ ...valid, verifiedQuestions: [{ question: 'q' }] }).success).toBe(false);
  });

  it('accepts omitted optional fields', () => {
    const { owner, datasource, interpretation, ...rest } = valid;
    expect(metricSchema.safeParse(rest).success).toBe(true);
  });
});

describe('metricCatalogSchema', () => {
  it('accepts an empty catalog', () => {
    expect(metricCatalogSchema.safeParse([]).success).toBe(true);
  });

  it('accepts exactly MAX_METRICS entries', () => {
    const catalog = Array.from({ length: MAX_METRICS }, (_, i) => ({ ...valid, id: 'metric-' + i, name: 'Metric ' + i, synonyms: [] }));
    expect(metricCatalogSchema.safeParse(catalog).success).toBe(true);
  });

  it('rejects more than MAX_METRICS entries', () => {
    const catalog = Array.from({ length: MAX_METRICS + 1 }, (_, i) => ({ ...valid, id: 'metric-' + i, name: 'Metric ' + i, synonyms: [] }));
    expect(metricCatalogSchema.safeParse(catalog).success).toBe(false);
  });

  it('rejects a duplicate id', () => {
    const result = metricCatalogSchema.safeParse([valid, { ...valid, name: 'Anderer Name', synonyms: [] }]);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.message.includes('Doppelte ID'))).toBe(true);
    }
  });

  it('rejects a duplicate name case-insensitively', () => {
    const result = metricCatalogSchema.safeParse([
      valid,
      { ...valid, id: 'other-id', name: valid.name.toUpperCase(), synonyms: [] },
    ]);
    expect(result.success).toBe(false);
  });

  it('rejects a synonym colliding with another metric name (case-insensitive)', () => {
    const result = metricCatalogSchema.safeParse([
      valid,
      { ...valid, id: 'other-id', name: 'Etwas anderes', synonyms: [valid.name.toLowerCase()] },
    ]);
    expect(result.success).toBe(false);
  });

  it('accepts distinct metrics with no overlapping names/synonyms', () => {
    const result = metricCatalogSchema.safeParse([
      valid,
      { ...valid, id: 'other-id', name: 'Anderer Name', synonyms: ['XYZ'] },
    ]);
    expect(result.success).toBe(true);
  });
});

describe('renderMetricCatalogForPrompt', () => {
  it('returns an empty string for an empty catalog', () => {
    expect(renderMetricCatalogForPrompt([])).toBe('');
  });

  it('renders one compact line per metric with synonyms and owner', () => {
    const text = renderMetricCatalogForPrompt([valid]);
    expect(text).toBe('- Deckungsbeitrag II (DB2, DB II, CM2): Umsatz − variable Kosten − Fixkosten [Owner: Controlling]');
  });

  it('omits the synonym and owner parts when absent', () => {
    const { owner, ...withoutOwner } = valid;
    const text = renderMetricCatalogForPrompt([{ ...withoutOwner, synonyms: [] }]);
    expect(text).toBe('- Deckungsbeitrag II: Umsatz − variable Kosten − Fixkosten');
  });

  it('joins multiple metrics with newlines', () => {
    const second: Metric = { ...valid, id: 'zweite-kennzahl', name: 'Zweite Kennzahl', synonyms: [] };
    const text = renderMetricCatalogForPrompt([valid, second]);
    expect(text.split('\n')).toHaveLength(2);
  });

  it('stays within the prompt budget and appends a truncation note for a large catalog', () => {
    const catalog: Metric[] = Array.from({ length: MAX_METRICS }, (_, i) => ({
      id: 'metric-' + i,
      name: 'Kennzahl ' + i,
      synonyms: [],
      definition: 'x'.repeat(MAX_METRIC_DEFINITION_CHARS),
      verifiedQuestions: [],
    }));
    const text = renderMetricCatalogForPrompt(catalog);
    expect(text.length).toBeLessThanOrEqual(METRIC_CATALOG_PROMPT_BUDGET_CHARS);
    expect(text).toContain('weitere — per lookup_metric abrufbar');
  });

  it('never exceeds the budget even for a single very long metric', () => {
    const text = renderMetricCatalogForPrompt([{ ...valid, definition: 'x'.repeat(MAX_METRIC_DEFINITION_CHARS) }]);
    expect(text.length).toBeLessThanOrEqual(METRIC_CATALOG_PROMPT_BUDGET_CHARS);
  });
});
