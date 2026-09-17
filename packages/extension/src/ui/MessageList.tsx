import { describeAction, t, type DashboardAction } from '@openvizpilot/shared';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { ChatItem } from './items';
import { renderMarkdown } from './markdown';

/** Ab welchem Abstand zum unteren Rand (px) automatisches Folgen aktiv bleibt (P1 Nr. 1). */
export const STICK_TO_BOTTOM_THRESHOLD_PX = 40;

export function isNearBottom(
  metrics: { scrollTop: number; scrollHeight: number; clientHeight: number },
  threshold: number = STICK_TO_BOTTOM_THRESHOLD_PX,
): boolean {
  const distanceFromBottom = metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight;
  return distanceFromBottom <= threshold;
}

/** Technische Tool-Namen → verständliche Schrittbezeichnung (P2 Nr. 9); unbekannte Namen bleiben unverändert. */
const TOOL_LABEL_KEYS: Record<string, string> = {
  list_worksheets: 'message.tool.list_worksheets',
  get_worksheet_fields: 'message.tool.get_worksheet_fields',
  get_worksheet_summary_data: 'message.tool.get_worksheet_summary_data',
  get_filters: 'message.tool.get_filters',
  get_parameters: 'message.tool.get_parameters',
  get_selected_marks: 'message.tool.get_selected_marks',
  get_datasource_info: 'message.tool.get_datasource_info',
  aggregate_summary_data: 'message.tool.aggregate_summary_data',
};

export function toolStepLabel(name: string): string {
  const key = TOOL_LABEL_KEYS[name];
  return key ? t(key) : name;
}

type AssistantItem = Extract<ChatItem, { kind: 'assistant' }>;

export interface LiveAnnouncement {
  /** id der Assistant-Message, für die zuletzt „wird erstellt“ gemeldet wurde (null = keine offene Meldung). */
  streamingId: number | null;
  text: string;
}

export const INITIAL_LIVE_ANNOUNCEMENT: LiveAnnouncement = { streamingId: null, text: '' };

/**
 * Höfliche Live-Region für Screenreader (P1 Nr. 6): meldet nur Beginn und Ende
 * einer Antwort als Zustandsübergang — nicht bei jedem Streaming-Token, damit
 * nicht der ganze Verlauf vorgelesen wird.
 */
export function nextLiveAnnouncement(prev: LiveAnnouncement, items: ChatItem[]): LiveAnnouncement {
  let lastAssistant: AssistantItem | undefined;
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item?.kind === 'assistant') {
      lastAssistant = item;
      break;
    }
  }
  if (!lastAssistant) return prev;
  if (lastAssistant.streaming && prev.streamingId !== lastAssistant.id) {
    return { streamingId: lastAssistant.id, text: t('message.live.generating') };
  }
  if (!lastAssistant.streaming && prev.streamingId === lastAssistant.id) {
    return { streamingId: null, text: t('message.live.done') };
  }
  return prev;
}

export function MessageList(props: {
  items: ChatItem[];
  busy: boolean;
  /** Vorschlagsfragen für den leeren Zustand (client-seitig abgeleitet, ★ = gespeicherte Standardfrage). */
  starters: string[];
  /**
   * Wenn gesetzt, zeigt der leere Zustand ZUERST die Onboarding-Frage nach
   * dem Antwortfokus (statt der normalen Starter-Chips) — siehe App.tsx.
   */
  onboarding?: {
    presets: string[];
    onPick: (preset: string) => void;
    onSkip: () => void;
  };
  onRetry: () => void;
  onSend: (text: string) => void;
  onAction: (action: DashboardAction) => void;
  /** Speichert eine User-Frage als Standardfrage (☆-Button); undefined = kein Button (keine User-ID). */
  onSaveStandard?: (text: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Nur automatisch ans Ende folgen, solange der Nutzer nahe am unteren Rand
  // ist (P1 Nr. 1) — sonst bleibt die Leseposition beim Streaming stabil.
  const stickToBottomRef = useRef(true);
  const [stickToBottom, setStickToBottomState] = useState(true);
  const lastUserIdRef = useRef<number | null>(null);
  const [live, setLive] = useState<LiveAnnouncement>(INITIAL_LIVE_ANNOUNCEMENT);

  const setStick = (value: boolean) => {
    stickToBottomRef.current = value;
    setStickToBottomState(value);
  };

  useEffect(() => {
    const el = ref.current;
    // Eine selbst gesendete Frage scrollt immer zum neuen Beitrag und nimmt
    // das automatische Folgen wieder auf, unabhängig von der Scrollposition.
    const last = props.items[props.items.length - 1];
    if (last?.kind === 'user' && last.id !== lastUserIdRef.current) {
      lastUserIdRef.current = last.id;
      setStick(true);
    }
    if (el && stickToBottomRef.current) el.scrollTop = el.scrollHeight;
    setLive((prev) => nextLiveAnnouncement(prev, props.items));
  }, [props.items]);

  const onScroll = () => {
    const el = ref.current;
    if (!el) return;
    setStick(isNearBottom({ scrollTop: el.scrollTop, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight }));
  };

  const jumpToLatest = () => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
    setStick(true);
  };

  return (
    <div class="messages" ref={ref} onScroll={onScroll}>
      {/* Höfliche Live-Region: meldet Beginn/Ende der Antwort, ohne bei jedem
          Token den ganzen Verlauf vorzulesen oder Fokus zu stehlen. */}
      <div class="sr-only" role="status" aria-live="polite">
        {live.text}
      </div>
      {/* Empty-State auch zeigen, solange nur Notices da sind (z. B. direkt
          nach dem Fokus-Onboarding) — sonst verschwinden die Starter-Chips. */}
      {props.items.every((i) => i.kind === 'notice') && (
        <div class="empty-hint">
          {props.onboarding ? (
            <>
              <p>{t('message.empty.onboardingPrompt')}</p>
              <div class="chips-row chips-center">
                {props.onboarding.presets.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    class="chip"
                    onClick={() => props.onboarding?.onPick(preset)}
                  >
                    {preset}
                  </button>
                ))}
                <button
                  type="button"
                  class="chip chip-secondary"
                  onClick={() => props.onboarding?.onSkip()}
                >
                 {t('message.empty.skipFocus')}
                </button>
              </div>
            </>
          ) : (
            <>
              <p>{t('message.empty.startPrompt')}</p>
              <div class="chips-row chips-center">
                {props.starters.map((s) => (
                  <button key={s} type="button" class="chip" disabled={props.busy} onClick={() => props.onSend(s)}>
                    {s}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
      {props.items.map((item) => {
        switch (item.kind) {
          case 'user':
            return (
              <div key={item.id} class="msg-row-user">
                <div class="msg msg-user">{item.text}</div>
                {props.onSaveStandard && (
                   <button
                  type="button"
                  class="btn-icon btn-star"
                  title={t('message.saveStandardTitle')}
                  aria-label={t('message.saveStandardTitle')}
                  disabled={props.busy}
                  onClick={() => props.onSaveStandard?.(item.text)}
                   >
                    ☆
                  </button>
                )}
              </div>
            );
          case 'assistant':
            if (item.text === '' && !item.streaming) return null;
            return (
              <div key={item.id} class="msg msg-assistant">
                {item.text === '' ? (
                 <span class="thinking" role="status" aria-live="polite">{t('message.thinking')}</span>
                ) : (
                  <div
                    class="markdown"
                    // eslint-disable-next-line react/no-danger — Output läuft durch DOMPurify
                    dangerouslySetInnerHTML={{ __html: renderMarkdown(item.text) }}
                  />
                )}
                {item.streaming && <span class="cursor">▌</span>}
              </div>
            );
          case 'tool':
            return (
              <details key={item.id} class={`tool-chip tool-${item.status}`}>
                <summary>
                  <span aria-hidden="true">{item.status === 'running' ? '⚙️' : '✓'}</span>{' '}
                  {toolStepLabel(item.name)}
                  <span class="tool-state"> · {item.status === 'running' ? t('message.tool.running') : t('message.tool.done')}</span>
                  {item.argsSummary && <span class="tool-args"> · {item.argsSummary}</span>}
                </summary>
                {/* Technischer Tool-Name bleibt in den ausklappbaren Details (P2 Nr. 9). */}
                <div class="tool-tech">{item.name}</div>
                {item.preview && <pre>{item.preview}</pre>}
              </details>
            );
          case 'suggestions':
            return (
              <div key={item.id} class="chips-row">
                {item.suggestions.actions.map((a, i) => (
                  <button
                    key={`a${i}`}
                    type="button"
                    class="chip chip-action"
                    disabled={props.busy}
                    onClick={() => props.onAction(a)}
                  >
                    <span class="chip-label">⚡ {a.label}</span>
                    <span class="chip-detail">{describeAction(a)}</span>
                  </button>
                ))}
                {item.suggestions.followups.map((f, i) => (
                  <button
                    key={`f${i}`}
                    type="button"
                    class="chip"
                    disabled={props.busy}
                    onClick={() => props.onSend(f)}
                  >
                    {f}
                  </button>
                ))}
              </div>
            );
          case 'notice':
            return (
              <div key={item.id} class="notice" role="status" aria-live="polite">
                {item.text}
              </div>
            );
          case 'error':
            return (
              <div key={item.id} class="error-banner" role="alert">
                <span>{item.text}</span>
                {item.retryable && (
                 <button type="button" disabled={props.busy} onClick={props.onRetry}>
                   {t('message.retry')}
                 </button>
                )}
              </div>
            );
        }
      })}
      {!stickToBottom && (
        <button type="button" class="jump-to-latest" onClick={jumpToLatest}>
          {t('message.jumpToLatest')}
        </button>
      )}
    </div>
  );
}
