import { describeAction, t, type DashboardAction } from '@openvizpilot/shared';
import { useEffect, useRef } from 'preact/hooks';
import type { ChatItem } from './items';
import { renderMarkdown } from './markdown';

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

  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [props.items]);

  return (
    <div class="messages" ref={ref}>
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
                 <span class="thinking">{t('message.thinking')}</span>
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
                  {item.status === 'running' ? '⚙️' : '✓'} {item.name}
                  {item.argsSummary && <span class="tool-args"> · {item.argsSummary}</span>}
                </summary>
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
              <div key={item.id} class="notice">
                {item.text}
              </div>
            );
          case 'error':
            return (
              <div key={item.id} class="error-banner">
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
    </div>
  );
}
