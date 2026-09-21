import { t } from '@openvizpilot/shared';
import { describe, expect, it } from 'vitest';
import { reducer } from '../src/ui/chat-reducer';
import type { ChatItem } from '../src/ui/items';

function errors(items: ChatItem[]) {
  return items.filter((i): i is ChatItem & { kind: 'error' } => i.kind === 'error');
}

// UI-Review P1-5: ein Retry muss den betroffenen Fehler eindeutig umschalten
// und darf keinen veralteten Fehler mit falschem Retry-Bezug übrig lassen.
describe('chat-reducer retry handling', () => {
  it('switches the retried error to "retrying" and disables its retry button', () => {
    let items: ChatItem[] = [];
    items = reducer(items, { type: 'user', text: 'Frage A' });
    items = reducer(items, { type: 'error', text: 'Netzwerkfehler', retryable: true });
    expect(errors(items)).toHaveLength(1);
    expect(errors(items)[0]?.retryable).toBe(true);
    expect(errors(items)[0]?.retrying).toBeFalsy();

    // Retry: kein 'user' dazwischen, nur 'round-start' (wie in App.tsx: onRetry -> runTurn(null)).
    items = reducer(items, { type: 'round-start' });
    const retrying = errors(items);
    expect(retrying).toHaveLength(1);
    expect(retrying[0]).toMatchObject({ text: t('message.retrying'), retryable: false, retrying: true });
  });

  it('clears the retrying placeholder once the retry succeeds', () => {
    let items: ChatItem[] = [];
    items = reducer(items, { type: 'user', text: 'Frage A' });
    items = reducer(items, { type: 'error', text: 'Netzwerkfehler', retryable: true });
    items = reducer(items, { type: 'round-start' }); // retry
    items = reducer(items, { type: 'finalize', text: 'Antwort da.' });
    expect(errors(items)).toHaveLength(0);
    expect(items.some((i) => i.kind === 'assistant' && i.text === 'Antwort da.')).toBe(true);
  });

  it('replaces the retrying placeholder with a fresh error on a repeated failure', () => {
    let items: ChatItem[] = [];
    items = reducer(items, { type: 'user', text: 'Frage A' });
    items = reducer(items, { type: 'error', text: 'Netzwerkfehler', retryable: true });
    items = reducer(items, { type: 'round-start' }); // retry
    items = reducer(items, { type: 'error', text: 'Erneut fehlgeschlagen', retryable: true });
    const current = errors(items);
    expect(current).toHaveLength(1);
    expect(current[0]).toMatchObject({ text: 'Erneut fehlgeschlagen', retryable: true });
  });

  it('marks an older error as historic (no longer retryable) once a new question is sent', () => {
    let items: ChatItem[] = [];
    items = reducer(items, { type: 'user', text: 'Frage A' });
    items = reducer(items, { type: 'error', text: 'Netzwerkfehler', retryable: true });
    // Neue Frage statt Retry: 'user' kommt vor dem nächsten 'round-start'.
    items = reducer(items, { type: 'user', text: 'Frage B' });
    items = reducer(items, { type: 'round-start' });
    const historic = errors(items);
    expect(historic).toHaveLength(1);
    expect(historic[0]).toMatchObject({ text: 'Netzwerkfehler', retryable: false });
  });
});

function lastAssistant(items: ChatItem[]) {
  return [...items].reverse().find((i): i is ChatItem & { kind: 'assistant' } => i.kind === 'assistant');
}

// W1 Trust Layer: der Badge "✓ Verifizierte Definition: …" darf nur aus einem
// abgeschlossenen lookup_metric-Aufruf mit Treffer seit der letzten User-Frage
// abgeleitet werden.
describe('chat-reducer verifiedMetrics badge derivation', () => {
  it('attaches the metric name from a done lookup_metric tool call with a hit', () => {
    let items: ChatItem[] = [];
    items = reducer(items, { type: 'user', text: 'Was ist DB2?' });
    items = reducer(items, { type: 'round-start' });
    items = reducer(items, {
      type: 'tool',
      callId: 'c1',
      name: 'lookup_metric',
      status: 'done',
      preview: 'metric: Deckungsbeitrag II\n\n**Deckungsbeitrag II**\nDefinition: …',
    });
    items = reducer(items, { type: 'finalize', text: 'DB2 ist …' });
    expect(lastAssistant(items)?.verifiedMetrics).toEqual(['Deckungsbeitrag II']);
  });

  it('does not attach a badge when lookup_metric found no match', () => {
    let items: ChatItem[] = [];
    items = reducer(items, { type: 'user', text: 'Was ist XYZ?' });
    items = reducer(items, { type: 'round-start' });
    items = reducer(items, { type: 'tool', callId: 'c1', name: 'lookup_metric', status: 'done', preview: 'metric: none\n\nKeine Kennzahl…' });
    items = reducer(items, { type: 'finalize', text: 'XYZ ist kein bekannter Begriff.' });
    expect(lastAssistant(items)?.verifiedMetrics).toBeUndefined();
  });

  it('does not attach a badge while the tool call is still running', () => {
    let items: ChatItem[] = [];
    items = reducer(items, { type: 'user', text: 'Was ist DB2?' });
    items = reducer(items, { type: 'round-start' });
    items = reducer(items, { type: 'tool', callId: 'c1', name: 'lookup_metric', status: 'running' });
    items = reducer(items, { type: 'finalize', text: 'Antwort ohne Tool-Ergebnis.' });
    expect(lastAssistant(items)?.verifiedMetrics).toBeUndefined();
  });

  it('ignores lookup_metric calls from an earlier user turn', () => {
    let items: ChatItem[] = [];
    items = reducer(items, { type: 'user', text: 'Was ist DB2?' });
    items = reducer(items, { type: 'round-start' });
    items = reducer(items, { type: 'tool', callId: 'c1', name: 'lookup_metric', status: 'done', preview: 'metric: Deckungsbeitrag II\n\n…' });
    items = reducer(items, { type: 'finalize', text: 'DB2 ist …' });
    items = reducer(items, { type: 'user', text: 'Und wie hoch ist der Umsatz?' });
    items = reducer(items, { type: 'round-start' });
    items = reducer(items, { type: 'finalize', text: 'Der Umsatz beträgt …' });
    expect(lastAssistant(items)?.verifiedMetrics).toBeUndefined();
  });
});
