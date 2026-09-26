import { t, type Suggestions } from '@openvizpilot/shared';
import { parseWatchProposal } from '@openvizpilot/ee/extension';
import type { ChatItem } from './items';

// Ausgelagert aus App.tsx, damit der Chatverlauf-Reducer ohne Tableau-/DOM-
// Abhängigkeiten (siehe main.tsx/App.tsx) importier- und testbar ist.

let nextId = 1;

export type Action =
  | { type: 'user'; text: string }
  | { type: 'round-start' }
  | { type: 'delta'; text: string }
  | { type: 'finalize'; text: string }
  | { type: 'suggestions'; suggestions: Suggestions }
  | {
      type: 'tool';
      callId: string;
      name: string;
      argsSummary?: string;
      status: 'running' | 'done';
      preview?: string;
    }
  | { type: 'notice'; text: string }
  | { type: 'error'; text: string; retryable: boolean }
  | { type: 'done' }
  | { type: 'clear' }
  /** OpenViz Watch (W6): die Bestätigungskarte einer Assistant-Message wurde angelegt oder verworfen — entfernt sie. */
  | { type: 'watch-proposal-handled'; id: number };

export function reducer(items: ChatItem[], action: Action): ChatItem[] {
  switch (action.type) {
    case 'user':
      // Alte Vorschlags-Chips sind mit der neuen Frage obsolet.
      return [
        ...items.filter((i) => i.kind !== 'suggestions'),
        { kind: 'user', id: nextId++, text: action.text },
      ];
    case 'round-start': {
      // Chips einer früheren Antwort verschwinden, sobald eine neue Runde
      // läuft (gilt auch für Retry, der keine 'user'-Action dispatcht).
      const cleaned = finalizeStreaming(items).filter((i) => i.kind !== 'suggestions');
      const last = cleaned[cleaned.length - 1];
      if (last?.kind === 'error' && last.retryable) {
        // Kein 'user' seit diesem Fehler dazwischen → dieser Start ist der
        // Retry genau dieses Fehlers. Eintrag umschalten statt ihn stehen zu
        // lassen, sonst wirkt ein späterer Erfolg neben einem alten Fehler
        // widersprüchlich (siehe UI-Review P1-5).
        const updated = [...cleaned];
        updated[updated.length - 1] = { ...last, text: t('message.retrying'), retryable: false, retrying: true };
        return [...updated, { kind: 'assistant', id: nextId++, text: '', streaming: true }];
      }
      // Neue Frage: ein noch anzeigter Fehler ist jetzt historisch — sein
      // Retry würde sich sonst auf die neue statt die fehlgeschlagene Frage
      // beziehen.
      const historized = cleaned.map((i) => (i.kind === 'error' ? { ...i, retryable: false } : i));
      return [...historized, { kind: 'assistant', id: nextId++, text: '', streaming: true }];
    }
    case 'delta': {
      const last = items[items.length - 1];
      if (last?.kind === 'assistant' && last.streaming) {
        return [...items.slice(0, -1), { ...last, text: last.text + action.text }];
      }
      return [...items, { kind: 'assistant', id: nextId++, text: action.text, streaming: true }];
    }
    case 'finalize': {
      // Gestreamten Text durch die bereinigte Endfassung ersetzen (der
      // <suggestions>-Block wird herausgeschnitten). Robust die LETZTE
      // Assistant-Bubble suchen — dahinter können bereits Notices liegen.
      // Ein erfolgreicher Abschluss beendet auch einen laufenden
      // Retry-Hinweis (siehe 'round-start') — sonst bliebe er neben der
      // neuen Antwort stehen (UI-Review P1-5).
      const withoutRetrying = items.filter((i) => !(i.kind === 'error' && i.retrying));
      for (let i = withoutRetrying.length - 1; i >= 0; i--) {
        const it = withoutRetrying[i];
        if (it?.kind === 'assistant') {
          const updated = [...withoutRetrying];
          const verifiedMetrics = verifiedMetricsSince(withoutRetrying);
          updated[i] = {
            ...it,
            text: action.text,
            streaming: false,
            verifiedMetrics: verifiedMetrics.length > 0 ? verifiedMetrics : undefined,
            watchProposal: watchProposalSince(withoutRetrying),
          };
          return updated;
        }
      }
      return withoutRetrying;
    }
    case 'suggestions':
      return [...items, { kind: 'suggestions', id: nextId++, suggestions: action.suggestions }];
    case 'tool': {
      const idx = items.findIndex((i) => i.kind === 'tool' && i.callId === action.callId);
      if (idx >= 0) {
        const updated = [...items];
        updated[idx] = {
          kind: 'tool',
          id: (items[idx] as ChatItem & { id: number }).id,
          callId: action.callId,
          name: action.name,
          argsSummary: action.argsSummary,
          status: action.status,
          preview: action.preview,
        };
        return updated;
      }
      return [
        ...finalizeStreaming(items),
        {
          kind: 'tool',
          id: nextId++,
          callId: action.callId,
          name: action.name,
          argsSummary: action.argsSummary,
          status: action.status,
          preview: action.preview,
        },
      ];
    }
    case 'notice':
      return [...items, { kind: 'notice', id: nextId++, text: action.text }];
    case 'error':
      // Ein erneuter Fehlschlag ersetzt einen laufenden Retry-Hinweis, statt
      // ihn stehen zu lassen (UI-Review P1-5).
      return [
        ...finalizeStreaming(items).filter((i) => !(i.kind === 'error' && i.retrying)),
        { kind: 'error', id: nextId++, text: action.text, retryable: action.retryable },
      ];
    case 'done':
      return finalizeStreaming(items);
    case 'clear':
      return [];
    case 'watch-proposal-handled':
      return items.map((i) => (i.kind === 'assistant' && i.id === action.id ? { ...i, watchProposal: undefined } : i));
  }
}

function finalizeStreaming(items: ChatItem[]): ChatItem[] {
  return items.map((i) => (i.kind === 'assistant' && i.streaming ? { ...i, streaming: false } : i));
}

/**
 * W1 Trust Layer: Namen der Kennzahlen, die seit der letzten User-Frage per
 * `lookup_metric` bestätigt wurden (abgeschlossene Tool-Aufrufe, deren
 * `preview` mit der maschinenlesbaren Zeile `metric: <Name>` beginnt — siehe
 * executors/metrics.ts; `metric: none` = kein Treffer, zählt nicht).
 */
function verifiedMetricsSince(items: ChatItem[]): string[] {
  let start = 0;
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i]?.kind === 'user') {
      start = i;
      break;
    }
  }
  const names: string[] = [];
  for (let i = start; i < items.length; i++) {
    const it = items[i];
    if (it?.kind !== 'tool' || it.name !== 'lookup_metric' || it.status !== 'done' || !it.preview) continue;
    const firstLine = it.preview.split('\n', 1)[0]?.trim() ?? '';
    const match = /^metric:\s*(.+)$/.exec(firstLine);
    const name = match?.[1]?.trim();
    if (name && name !== 'none' && !names.includes(name)) names.push(name);
  }
  return names;
}

/**
 * OpenViz Watch (W6): der zuletzt vorgeschlagene Vorschlag aus einem
 * abgeschlossenen `propose_watch_rule`-Aufruf seit der letzten User-Frage —
 * dieselbe deterministische Ableitung aus dem Tool-Ergebnis wie bei den
 * verifizierten Kennzahlen oben (der Agenten-Loop kürzt diese Vorschau
 * nicht). `parseWatchProposal` liefert `null` bei einem unerwarteten
 * Ergebnis — dann bleibt die Karte aus, statt mit falschen Werten zu erscheinen.
 */
function watchProposalSince(items: ChatItem[]) {
  let start = 0;
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i]?.kind === 'user') {
      start = i;
      break;
    }
  }
  let found: ReturnType<typeof parseWatchProposal> | undefined;
  for (let i = start; i < items.length; i++) {
    const it = items[i];
    if (it?.kind !== 'tool' || it.name !== 'propose_watch_rule' || it.status !== 'done' || !it.preview) continue;
    const proposal = parseWatchProposal(it.preview);
    if (proposal) found = proposal;
  }
  return found ?? undefined;
}
