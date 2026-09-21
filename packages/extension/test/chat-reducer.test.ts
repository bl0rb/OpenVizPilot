import { EE_STUB } from '@openvizpilot/ee/extension';
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

// OpenViz Watch (W6): die Bestätigungskarte wird deterministisch aus einem
// abgeschlossenen propose_watch_rule-Aufruf seit der letzten User-Frage
// abgeleitet — analog zu den verifizierten Kennzahlen oben. Im Core-Export
// (EE_STUB) liefert parseWatchProposal immer null — dort entsteht nie eine Karte.
describe.skipIf(EE_STUB)('chat-reducer watch proposal derivation', () => {
  const proposalJson = JSON.stringify({
    proposal: {
      name: 'Marge unter 20 %',
      viewId: '11111111-1111-4111-8111-111111111111',
      viewName: 'Marge-Dashboard',
      measure: { column: 'Marge', aggregate: 'avg' },
      condition: { type: 'below', threshold: 20 },
      schedule: { every: '1h', timezone: 'Europe/Berlin' },
      channel: { type: 'email', target: '' },
    },
  });

  it('attaches the parsed proposal from a done propose_watch_rule tool call', () => {
    let items: ChatItem[] = [];
    items = reducer(items, { type: 'user', text: 'Sag mir Bescheid, wenn die Marge unter 20% fällt.' });
    items = reducer(items, { type: 'round-start' });
    items = reducer(items, { type: 'tool', callId: 'c1', name: 'propose_watch_rule', status: 'done', preview: proposalJson });
    items = reducer(items, { type: 'finalize', text: 'Hier ist ein Vorschlag.' });
    expect(lastAssistant(items)?.watchProposal).toMatchObject({ name: 'Marge unter 20 %', viewId: '11111111-1111-4111-8111-111111111111' });
  });

  it('does not attach a proposal while the tool call is still running or on a malformed result', () => {
    let items: ChatItem[] = [];
    items = reducer(items, { type: 'user', text: 'Beobachte das Dashboard.' });
    items = reducer(items, { type: 'round-start' });
    items = reducer(items, { type: 'tool', callId: 'c1', name: 'propose_watch_rule', status: 'running' });
    items = reducer(items, { type: 'finalize', text: 'Einen Moment …' });
    expect(lastAssistant(items)?.watchProposal).toBeUndefined();

    let items2: ChatItem[] = [];
    items2 = reducer(items2, { type: 'user', text: 'Beobachte das Dashboard.' });
    items2 = reducer(items2, { type: 'round-start' });
    items2 = reducer(items2, { type: 'tool', callId: 'c1', name: 'propose_watch_rule', status: 'done', preview: '{"error":"kaputt"}' });
    items2 = reducer(items2, { type: 'finalize', text: 'Das hat nicht geklappt.' });
    expect(lastAssistant(items2)?.watchProposal).toBeUndefined();
  });

  it('ignores a propose_watch_rule call from an earlier user turn', () => {
    let items: ChatItem[] = [];
    items = reducer(items, { type: 'user', text: 'Beobachte das Dashboard.' });
    items = reducer(items, { type: 'round-start' });
    items = reducer(items, { type: 'tool', callId: 'c1', name: 'propose_watch_rule', status: 'done', preview: proposalJson });
    items = reducer(items, { type: 'finalize', text: 'Hier ist ein Vorschlag.' });
    items = reducer(items, { type: 'user', text: 'Und der Umsatz?' });
    items = reducer(items, { type: 'round-start' });
    items = reducer(items, { type: 'finalize', text: 'Der Umsatz beträgt …' });
    expect(lastAssistant(items)?.watchProposal).toBeUndefined();
  });

  it('removes the proposal once handled (created or discarded)', () => {
    let items: ChatItem[] = [];
    items = reducer(items, { type: 'user', text: 'Beobachte das Dashboard.' });
    items = reducer(items, { type: 'round-start' });
    items = reducer(items, { type: 'tool', callId: 'c1', name: 'propose_watch_rule', status: 'done', preview: proposalJson });
    items = reducer(items, { type: 'finalize', text: 'Hier ist ein Vorschlag.' });
    const id = lastAssistant(items)!.id;
    expect(lastAssistant(items)?.watchProposal).toBeDefined();
    items = reducer(items, { type: 'watch-proposal-handled', id });
    expect(lastAssistant(items)?.watchProposal).toBeUndefined();
  });
});
