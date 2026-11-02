import { t, type ChatMessage, type ChatRequest, type ParsedSSEEvent, type ToolCall } from '@openvizpilot/shared';

/**
 * Geskripteter Antwortgeber für den statischen Demo-Modus — ersetzt das LLM.
 *
 * Er spricht dasselbe SSE-Protokoll wie die Middleware (delta | tool_calls |
 * done) und nutzt die ECHTEN Dashboard-Tools der Extension: Je nach Frage
 * fordert er einen Tool-Call an (Filter, Top-Gruppen, Zeilen, Parameter …),
 * der Agent-Loop führt ihn gegen das geöffnete Workbook aus, und aus dem
 * Ergebnis entsteht die Antwort. Keine KI, keine Netzwerkverbindung.
 */

export interface ContextWorksheet {
  name: string;
  columns: Array<{ name: string; type: string }>;
  rowCount: number | null;
  filters: string[];
}

export interface ParsedContext {
  dashboard: string;
  worksheets: ContextWorksheet[];
}

/** Liest den Kontext-Snapshot (context-snapshot.ts) zurück in eine Struktur. */
export function parseContext(context: string): ParsedContext {
  const result: ParsedContext = { dashboard: '', worksheets: [] };
  let current: ContextWorksheet | null = null;
  let inFilters = false;
  for (const rawLine of context.split('\n')) {
    const line = rawLine.trimEnd();
    const dash = /^# Dashboard: (.+)$/.exec(line);
    if (dash?.[1]) {
      result.dashboard = dash[1].trim();
      continue;
    }
    const ws = /^## Worksheet: (.+)$/.exec(line);
    if (ws?.[1]) {
      current = {
        name: ws[1].replace(/ \(im Dashboard aktuell ausgeblendet\)$/, '').trim(),
        columns: [],
        rowCount: null,
        filters: [],
      };
      result.worksheets.push(current);
      inFilters = false;
      continue;
    }
    if (line.startsWith('## ')) {
      current = null;
      inFilters = false;
      continue;
    }
    if (!current) continue;
    const cols = /^Spalten: (.+)$/.exec(line);
    if (cols?.[1]) {
      for (const piece of cols[1].split(', ')) {
        const m = /^(.+) \(([^()]+)\)$/.exec(piece.trim());
        if (m?.[1] && m[2]) current.columns.push({ name: m[1], type: m[2] });
      }
      continue;
    }
    const rows = /^Zeilen \(aggregiert, gefiltert\): (\d+)$/.exec(line);
    if (rows?.[1]) {
      current.rowCount = Number(rows[1]);
      continue;
    }
    if (line === 'Aktive Filter:') {
      inFilters = true;
      continue;
    }
    if (line.startsWith('Aktive Filter: ')) {
      inFilters = false;
      continue;
    }
    if (inFilters && line.startsWith('- ')) {
      current.filters.push(line.slice(2));
      continue;
    }
    if (line === '') inFilters = false;
  }
  return result;
}

const NUMERIC_TYPES = new Set(['int', 'float']);

function isMeasure(col: { name: string; type: string }): boolean {
  return NUMERIC_TYPES.has(col.type);
}

/** Worksheet mit mindestens einer Dimension und einer Kennzahl — für Top-/Verteilungsfragen. */
function pickAnalysableWorksheet(ctx: ParsedContext, preferred?: ContextWorksheet): ContextWorksheet | null {
  const candidates = preferred ? [preferred, ...ctx.worksheets] : ctx.worksheets;
  for (const ws of candidates) {
    if (ws.columns.some(isMeasure) && ws.columns.some((c) => !isMeasure(c))) return ws;
  }
  return null;
}

/** Worksheet, dessen Name in der Frage vorkommt (längster Treffer zuerst). */
function mentionedWorksheet(question: string, ctx: ParsedContext): ContextWorksheet | undefined {
  const q = question.toLowerCase();
  return [...ctx.worksheets]
    .sort((a, b) => b.name.length - a.name.length)
    .find((ws) => ws.name.length >= 3 && q.includes(ws.name.toLowerCase()));
}

export interface PlannedTool {
  name: string;
  args: Record<string, unknown>;
}

const RE_FILTERS = /filter/i;
const RE_PARAMETERS = /parameter/i;
const RE_MARKS = /markier|auswahl|selekt|selected|selection|\bmarks?\b/i;
const RE_TOP = /\btop\b|größte|grösste|höchste|highest|largest|biggest|verteil|breakdown|anteil|share|auffäll|anomal|stands out|wichtigste|most important|rank/i;
const RE_SUMMARY = /zusammen|summar|overview|überblick|worum|inhalt|what is this|was ist das|dashboard/i;
const RE_SHOW = /zeigt|zeige|zeig|show|anzeigen|zeilen|rows|daten|data|werte|values|details/i;

/** Wählt zur Frage den passenden Tool-Call — oder null für eine reine Textantwort. */
export function planTool(question: string, ctx: ParsedContext): PlannedTool | null {
  const mentioned = mentionedWorksheet(question, ctx);
  if (RE_FILTERS.test(question)) return { name: 'get_filters', args: mentioned ? { worksheet: mentioned.name } : {} };
  if (RE_PARAMETERS.test(question)) return { name: 'get_parameters', args: {} };
  if (RE_MARKS.test(question)) {
    const ws = mentioned ?? ctx.worksheets[0];
    return ws ? { name: 'get_selected_marks', args: { worksheet: ws.name } } : null;
  }
  if (RE_TOP.test(question)) {
    const ws = pickAnalysableWorksheet(ctx, mentioned);
    if (ws) {
      const dimension = ws.columns.find((c) => !isMeasure(c))!;
      const measure = ws.columns.find(isMeasure)!;
      const wantsTop = /\btop\b|größte|grösste|höchste|highest|largest|biggest|rank/i.test(question);
      return {
        name: 'breakdown_by',
        args: { worksheet: ws.name, dimension: dimension.name, measure: measure.name, maxGroups: wantsTop ? 5 : 10 },
      };
    }
    const fallback = mentioned ?? ctx.worksheets[0];
    return fallback ? { name: 'get_worksheet_summary_data', args: { worksheet: fallback.name, maxRows: 10 } } : null;
  }
  if (mentioned) return { name: 'get_worksheet_summary_data', args: { worksheet: mentioned.name, maxRows: 10 } };
  if (RE_SUMMARY.test(question)) return { name: 'list_worksheets', args: {} };
  if (RE_SHOW.test(question)) {
    const ws = ctx.worksheets[0];
    return ws ? { name: 'get_worksheet_summary_data', args: { worksheet: ws.name, maxRows: 10 } } : null;
  }
  return null;
}

function followups(ctx: ParsedContext): string[] {
  const analysable = pickAnalysableWorksheet(ctx);
  const list = [
    t('demo.followup.filters'),
    analysable ? t('demo.followup.top', undefined, { name: analysable.name }) : t('demo.followup.summary'),
    ctx.worksheets[0] ? t('demo.followup.worksheet', undefined, { name: ctx.worksheets[0].name }) : t('demo.followup.parameters'),
  ];
  return [...new Set(list)].slice(0, 3);
}

function suggestionsBlock(ctx: ParsedContext): string {
  return `\n\n<suggestions>${JSON.stringify({ followups: followups(ctx) })}</suggestions>`;
}

/** Antworttext aus dem Tool-Ergebnis — der Kern der „Antwort ohne KI". */
export function composeAnswer(tool: ToolCall, result: string, ctx: ParsedContext): string {
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(tool.function.arguments || '{}') as Record<string, unknown>;
  } catch {
    /* leere Argumente */
  }
  const worksheet = typeof args.worksheet === 'string' ? args.worksheet : '';
  const activeFilters = ctx.worksheets.reduce((n, ws) => n + ws.filters.length, 0);
  let intro: string;
  switch (tool.function.name) {
    case 'get_filters':
      intro = t('demo.answer.filters');
      break;
    case 'get_parameters':
      intro = t('demo.answer.parameters');
      break;
    case 'get_selected_marks':
      intro = t('demo.answer.marks', undefined, { name: worksheet });
      break;
    case 'breakdown_by':
      intro = t('demo.answer.breakdown', undefined, {
        name: worksheet,
        dimension: String(args.dimension ?? ''),
        measure: String(args.measure ?? ''),
      });
      break;
    case 'get_worksheet_summary_data':
      intro = t('demo.answer.worksheet', undefined, { name: worksheet });
      break;
    case 'list_worksheets':
      intro = t('demo.answer.summary', undefined, {
        dashboard: ctx.dashboard,
        count: ctx.worksheets.length,
        filters: activeFilters,
      });
      break;
    default:
      intro = '';
  }
  // get_filters setzt Worksheet-Überschriften (**Name**) direkt unter die
  // Listenpunkte des Vorgängers — ohne Leerzeile rendert Markdown sie in die Liste.
  const body = tool.function.name === 'get_filters' ? result.replace(/\n(?=\*\*)/g, '\n\n') : result;
  return `${intro ? `${intro}\n\n` : ''}${body}${suggestionsBlock(ctx)}`;
}

function fallbackAnswer(ctx: ParsedContext): string {
  return `${t('demo.answer.fallback')}${suggestionsBlock(ctx)}`;
}

/** Letzte Assistant-Nachricht mit tool_calls, zu der eine Tool-Antwort gehört. */
function findToolCall(messages: ChatMessage[], toolCallId: string): ToolCall | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role === 'assistant' && m.tool_calls) {
      const call = m.tool_calls.find((c) => c.id === toolCallId);
      if (call) return call;
    }
  }
  return undefined;
}

export interface RespondOptions {
  /** Pause zwischen Text-Fragmenten (Streaming-Anmutung); 0 in Tests. */
  delayMs?: number;
  signal?: AbortSignal;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

let callCounter = 0;

/** Eine Runde des Demo-„LLM": liefert die Events einer /api/chat-Antwort. */
export async function* respond(request: ChatRequest, options: RespondOptions = {}): AsyncGenerator<ParsedSSEEvent> {
  const delayMs = options.delayMs ?? 18;
  const ctx = parseContext(request.context);
  const messages = request.messages;
  const last = messages[messages.length - 1];

  let text: string;
  if (last?.role === 'tool') {
    const call = findToolCall(messages, last.tool_call_id);
    text = call ? composeAnswer(call, last.content, ctx) : fallbackAnswer(ctx);
  } else {
    const question = last?.role === 'user' ? last.content : '';
    const planned = request.toolChoice === 'none' ? null : planTool(question, ctx);
    if (planned) {
      callCounter += 1;
      const toolCall: ToolCall = {
        id: `demo_call_${callCounter}`,
        type: 'function',
        function: { name: planned.name, arguments: JSON.stringify(planned.args) },
      };
      yield { event: 'tool_calls', data: { toolCalls: [toolCall] } };
      yield { event: 'done', data: { finishReason: 'tool_calls' } };
      return;
    }
    text = fallbackAnswer(ctx);
  }

  // Wortweise streamen — so sieht man das Antwortverhalten der echten Extension.
  for (const word of text.split(/(?<= )/)) {
    if (options.signal?.aborted) return;
    yield { event: 'delta', data: { content: word } };
    if (delayMs > 0) await sleep(delayMs);
  }
  yield { event: 'done', data: { finishReason: 'stop' } };
}
