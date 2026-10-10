import { describeAction, t, type DashboardAction } from '@openvizpilot/shared';
import { WatchProposalCard, type WatchRuleProposal } from '@openvizpilot/ee/extension';
import { useEffect, useRef, useState } from 'preact/hooks';
import { buildMarkdownExport, type ChatItem } from './items';
import { renderMarkdown } from './markdown';
import { Icon } from './icons';

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
  lookup_metric: 'message.tool.lookup_metric',
  breakdown_by: 'message.tool.breakdown_by',
  compare_periods: 'message.tool.compare_periods',
  tableau_server_search: 'message.tool.tableau_server_search',
  tableau_metadata_search: 'message.tool.tableau_metadata_search',
  tableau_metadata_field: 'message.tool.tableau_metadata_field',
  tableau_view_data: 'message.tool.tableau_view_data',
  propose_watch_rule: 'message.tool.propose_watch_rule',
};

export function toolStepLabel(name: string): string {
  const key = TOOL_LABEL_KEYS[name];
  return key ? t(key) : name;
}

/** Löst einen Blob-Download im Browser aus — keine reine Funktion, daher ungetestet (siehe buildMarkdownExport in items.ts). */
function downloadMarkdown(filename: string, content: string): void {
  try {
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch {
    /* Download in dieser Umgebung nicht möglich — kein Absturz. */
  }
}

type AssistantItem = Extract<ChatItem, { kind: 'assistant' }>;
type ToolItem = Extract<ChatItem, { kind: 'tool' }>;

export type RenderBlock = { kind: 'item'; item: ChatItem } | { kind: 'tool-group'; id: number; tools: ToolItem[] };

/**
 * Fasst aufeinanderfolgende Analyse-Schritte zu einer Gruppe zusammen, damit
 * lange Untersuchungen (bis zu 50 Tool-Runden) den Verlauf nicht fluten
 * (UI-Review P1). Einzelne Schritte bleiben eigenständig.
 */
export function groupToolItems(items: ChatItem[]): RenderBlock[] {
  const blocks: RenderBlock[] = [];
  let run: ToolItem[] = [];
  const flush = () => {
    if (run.length === 1) blocks.push({ kind: 'item', item: run[0]! });
    else if (run.length > 1) blocks.push({ kind: 'tool-group', id: run[0]!.id, tools: run });
    run = [];
  };
  for (const item of items) {
    if (item.kind === 'tool') {
      run.push(item);
      continue;
    }
    flush();
    blocks.push({ kind: 'item', item });
  }
  flush();
  return blocks;
}

function ToolStep(props: { item: ToolItem }) {
  const { item } = props;
  return (
    <details class={`tool-chip tool-${item.status}`}>
      <summary>
        {item.status === 'running' ? <span class="spinner" aria-hidden="true" /> : <Icon name="check" />}{' '}
        {toolStepLabel(item.name)}
        <span class="tool-state"> · {item.status === 'running' ? t('message.tool.running') : t('message.tool.done')}</span>
        {item.argsSummary && <span class="tool-args"> · {item.argsSummary}</span>}
      </summary>
      {/* Technischer Tool-Name bleibt in den ausklappbaren Details (P2 Nr. 9). */}
      <div class="tool-tech">{item.name}</div>
      {item.preview && <pre>{item.preview}</pre>}
    </details>
  );
}

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
  /** Bereits gespeicherte Standardfragen — deren Stern erscheint gefüllt. */
  savedQuestions?: string[];
  /** OpenViz Watch (W6): nur gesetzt, wenn das Feature lizenziert ist (Defense in Depth zum Server-Gate) — sonst erscheint nie eine Karte. */
  watch?: {
    signedInEmail?: string;
    onCreate: (proposal: WatchRuleProposal, itemId: number) => Promise<{ ok: boolean; message?: string }>;
    onDiscard: (itemId: number) => void;
  };
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
      {groupToolItems(props.items).map((block) => {
        if (block.kind === 'tool-group') {
          const running = block.tools.find((tool) => tool.status === 'running');
          return (
            <details key={`g${block.id}`} class={`tool-chip tool-group${running ? ' tool-running' : ''}`}>
              <summary>
                {running ? <span class="spinner" aria-hidden="true" /> : <Icon name="check" />}{' '}
                {t('message.tool.groupSummary', undefined, { count: block.tools.length })}
                {running && <span class="tool-state"> · {toolStepLabel(running.name)}</span>}
              </summary>
              <div class="tool-group-list">
                {block.tools.map((tool) => (
                  <ToolStep key={tool.id} item={tool} />
                ))}
              </div>
            </details>
          );
        }
        const item = block.item;
        switch (item.kind) {
          case 'user':
            return (
              <div key={item.id} class="msg-row-user">
                <div class="msg msg-user">{item.text}</div>
                {props.onSaveStandard && (() => {
                  const saved = props.savedQuestions?.some((q) => q.trim() === item.text.trim()) ?? false;
                  const label = saved ? t('message.savedStandardTitle') : t('message.saveStandardTitle');
                  return (
                    <button
                      type="button"
                      class={`btn-icon btn-star${saved ? ' btn-star-saved' : ''}`}
                      title={label}
                      aria-label={label}
                      aria-pressed={saved}
                      disabled={props.busy || saved}
                      onClick={() => props.onSaveStandard?.(item.text)}
                    >
                      <Icon name="star" filled={saved} />
                    </button>
                  );
                })()}
              </div>
            );
          case 'assistant': {
            if (item.text === '' && !item.streaming) return null;
            const finished = !item.streaming && item.text !== '';
            return (
              <div key={item.id} class="assistant-group">
                <div class="msg msg-assistant">
                  {item.text === '' ? (
                   // Kein eigenes role="status": Beginn/Ende meldet die zentrale Live-Region oben.
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
                {finished && (
                  <div class="assistant-footer">
                    <button
                      type="button"
                      class="btn-icon btn-download"
                      title={t('message.downloadMarkdown')}
                      aria-label={t('message.downloadMarkdown')}
                      onClick={() => {
                        const { filename, content } = buildMarkdownExport(item);
                        downloadMarkdown(filename, content);
                      }}
                    >
                      <Icon name="download" />
                    </button>
                    {item.verifiedMetrics?.map((name) => (
                      <span key={name} class="verified-metric" role="note">
                        <Icon name="check" /> {t('message.verifiedMetric')}: {name}
                      </span>
                    ))}
                  </div>
                )}
                {item.watchProposal && props.watch && (
                  <WatchProposalCard
                    proposal={item.watchProposal}
                    signedInEmail={props.watch.signedInEmail}
                    onCreate={(proposal) => props.watch!.onCreate(proposal, item.id)}
                    onDismiss={() => props.watch!.onDiscard(item.id)}
                  />
                )}
              </div>
            );
          }
          case 'tool':
            return <ToolStep key={item.id} item={item} />;
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
                    <span class="chip-label"><Icon name="zap" /> {a.label}</span>
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
