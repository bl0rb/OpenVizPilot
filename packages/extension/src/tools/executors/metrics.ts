import type { Metric } from '@openvizpilot/shared';

/**
 * W1 Trust Layer — Executor für das Tool `lookup_metric` gegen den Vertrag
 * von Agent A: `POST /api/metrics/lookup { query } → { metrics: Metric[] }`
 * (leeres Array = kein Treffer, Format/Validierung: packages/server/src/routes/metrics.ts).
 * Argumente sind bereits über `toolArgSchemas.lookup_metric` validiert
 * (registry.ts) — hier also nur noch die eigentliche Server-Abfrage und
 * Formatierung für das Modell.
 */

export interface MetricLookupNetwork {
  /** '' = gleicher Origin (siehe App.tsx: baseUrl aus den Extension-Einstellungen). */
  baseUrl: string;
  apiToken?: string;
}

function authHeaders(apiToken?: string): Record<string, string> {
  return apiToken ? { authorization: `Bearer ${apiToken}` } : {};
}

function formatMetric(metric: Metric): string {
  const lines: string[] = [`**${metric.name}**`];
  if (metric.synonyms.length > 0) {
    lines.push(`Synonyme: ${metric.synonyms.join(', ')}`);
  }
  lines.push(`Definition: ${metric.definition}`);
  if (metric.owner) lines.push(`Owner: ${metric.owner}`);
  if (metric.datasource) lines.push(`Datenquelle: ${metric.datasource}`);
  if (metric.interpretation) lines.push(`Interpretation: ${metric.interpretation}`);
  if (metric.verifiedQuestions.length > 0) {
    lines.push('Geprüfte Fragen:');
    for (const q of metric.verifiedQuestions) {
      lines.push(`- ${q.question} → ${q.answerGuidance}`);
    }
  }
  return lines.join('\n');
}

/**
 * Kein Treffer/Fehlerfall: `metric: none` als erste Zeile ist die
 * maschinenlesbare Markierung, die chat-reducer.ts auswertet, um den
 * „✓ Verifizierte Definition"-Badge NICHT zu setzen (siehe MessageList.tsx).
 */
function noMatch(message: string): string {
  return `metric: none\n\n${message}`;
}

/**
 * Führt `lookup_metric` gegen `${baseUrl}/api/metrics/lookup` aus. Wirft NIE
 * — jeder Fehler (Netz, HTTP-Status, ungültige Antwort) wird als Text mit
 * `metric: none` zurückgegeben, damit das LLM sich selbst korrigieren kann.
 */
export async function executeLookupMetric(
  args: { query: string },
  network: MetricLookupNetwork,
): Promise<string> {
  const query = args.query;
  try {
    const response = await fetch(`${network.baseUrl}/api/metrics/lookup`, {
      signal: AbortSignal.timeout(10_000),
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders(network.apiToken) },
      body: JSON.stringify({ query }),
    });
    if (!response.ok) {
      return noMatch('Kennzahlen-Katalog derzeit nicht verfügbar.');
    }
    const data = (await response.json()) as { metrics?: unknown };
    const metrics = Array.isArray(data.metrics) ? (data.metrics as Metric[]) : [];
    const best = metrics[0];
    if (!best) {
      return noMatch(`Keine Kennzahl im Katalog gefunden für „${query}".`);
    }
    return [`metric: ${best.name}`, '', metrics.map(formatMetric).join('\n\n---\n\n')].join('\n');
  } catch {
    return noMatch('Kennzahlen-Katalog derzeit nicht verfügbar.');
  }
}
