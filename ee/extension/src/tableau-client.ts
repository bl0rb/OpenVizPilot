import type { ToolCall } from '@openvizpilot/shared';

const MAX_RESULT_CHARS = 20_000;
const ARGUMENT_NAMES = ['query', 'type', 'project', 'owner', 'tag', 'limit'] as const;
const ENDPOINTS = new Map([
  ['tableau_server_search', '/api/tableau-server/search'],
  ['tableau_metadata_search', '/api/tableau-server/metadata/search'],
  ['tableau_metadata_field', '/api/tableau-server/metadata/field'],
]);

function parseObject(raw: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid search arguments');
  return parsed as Record<string, unknown>;
}

function parseArguments(name: string, raw: string): Record<string, unknown> {
  const source = parseObject(raw);
  if (name === 'tableau_metadata_field') {
    if (typeof source.fieldId !== 'string' || source.fieldId.length === 0 || source.fieldId.length > 200) throw new Error('Invalid field arguments');
    return { fieldId: source.fieldId };
  }
  const names = name === 'tableau_metadata_search'
    ? (['query', 'datasourceId', 'limit'] as const)
    : ARGUMENT_NAMES;
  for (const key of names) {
    const value = source[key];
    if (value === undefined) continue;
    if (key === 'limit') {
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 50) throw new Error('Invalid limit');
    } else if (typeof value !== 'string' || value.length > (key === 'tag' ? 100 : 200)) {
      throw new Error('Invalid string argument');
    }
  }
  if (name === 'tableau_server_search' && source.type !== undefined && !['all', 'workbook', 'view'].includes(String(source.type))) throw new Error('Invalid type');
  return Object.fromEntries(names.filter((key) => source[key] !== undefined).map((key) => [key, source[key]]));
}

function boundedJson(value: unknown, toolName: string): string {
  const encoded = JSON.stringify(value);
  if (encoded.length <= MAX_RESULT_CHARS) return encoded;
  const fallback = toolName === 'tableau_metadata_field'
    ? { source: 'Tableau Metadata API', truncated: true, field: null, limitations: ['Oversized metadata fields were omitted without partial values.'] }
    : { source: toolName === 'tableau_server_search' ? 'Tableau Server' : 'Tableau Metadata API', truncated: true, items: [], limitations: ['Oversized results were omitted.'] };
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return JSON.stringify(fallback);
  }
  const source = value as Record<string, unknown>;
  const limitations = Array.isArray(source.limitations) ? source.limitations.filter((item): item is string => typeof item === 'string') : [];
  const base = {
    ...source,
    truncated: true,
    limitations: [...limitations, 'Oversized metadata fields were omitted without partial values.'],
  };
  const items = Array.isArray(source.items) ? source.items : [];
  const kept: unknown[] = [];
  for (const item of items) {
    const candidate = JSON.stringify({ ...base, items: [...kept, item] });
    if (candidate.length > MAX_RESULT_CHARS) break;
    kept.push(item);
  }
  const candidate = { ...base, ...(Array.isArray(source.items) ? { items: kept } : {}) };
  if (JSON.stringify(candidate).length <= MAX_RESULT_CHARS) return JSON.stringify(candidate);
  return JSON.stringify(fallback);
}

/** Liest `code`/`error` aus einer Fehlerantwort, gibt aber nur für bekannte, unbedenkliche Codes die Server-Meldung weiter — sonst die generische Meldung (keine Upstream-Details an den Anwender/das Modell durchreichen). */
async function tableauErrorMessage(response: Response): Promise<string> {
  const fallback = 'Tableau-Suche derzeit nicht verfügbar.';
  try {
    const data = await response.json() as { error?: unknown; code?: unknown };
    return data.code === 'site_unresolved' && typeof data.error === 'string' ? data.error : fallback;
  } catch {
    return fallback;
  }
}

export async function executeTableauTool(input: {
  call: ToolCall;
  baseUrl: string;
  apiToken?: string;
  /** Ordnet die Abfrage einer Tableau-Site zu (Admin: Dashboard-Zuordnung); ohne Angabe genügt genau eine konfigurierte Site. */
  dashboardKey?: string;
  signal?: AbortSignal;
}): Promise<string> {
  const endpoint = ENDPOINTS.get(input.call.function.name);
  if (!endpoint) return JSON.stringify({ error: 'Unbekanntes Tool.' });
  try {
    const body = parseArguments(input.call.function.name, input.call.function.arguments);
    const response = await fetch(`${input.baseUrl}${endpoint}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(input.apiToken ? { authorization: `Bearer ${input.apiToken}` } : {}),
      },
      body: JSON.stringify({ ...body, dashboardKey: input.dashboardKey }),
      signal: input.signal,
    });
    if (!response.ok) return JSON.stringify({ error: await tableauErrorMessage(response) });
    return boundedJson(await response.json(), input.call.function.name);
  } catch (error) {
    if (input.signal?.aborted) throw error;
    return JSON.stringify({ error: 'Tableau-Suche derzeit nicht verfügbar.' });
  }
}
