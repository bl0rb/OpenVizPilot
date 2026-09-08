import type { ToolCall, ToolCallsEventData } from '@openvizpilot/shared';

export async function executeMcpTool(input: {
  call: ToolCall;
  approval?: NonNullable<ToolCallsEventData['external']>[string];
  dashboardKey: string;
  baseUrl: string;
  apiToken?: string;
  signal?: AbortSignal;
  confirm: (message: string) => boolean;
}): Promise<string> {
  const { call, approval, signal } = input;
  if (!approval || !input.dashboardKey) return 'Externe Abfrage nicht freigegeben. MCP benötigt eine Enterprise-Lizenz und eine Site-Freigabe.';
  if (signal?.aborted) return 'Externe Abfrage abgebrochen.';
  let args: unknown;
  try {
    args = JSON.parse(call.function.arguments || '{}');
  } catch {
    return 'Ungültige Argumente für die externe Abfrage.';
  }
  const approved = input.confirm(`Externe Datenübertragung freigeben?\n\nZiel: ${approval.destination}\nTool: ${call.function.name}\n\nArgumente:\n${JSON.stringify(args, null, 2)}\n\nNur freigeben, wenn diese Angaben an den Anbieter und dessen angebundene Dienste übermittelt werden dürfen.`);
  if (!approved || signal?.aborted) return 'Der Benutzer hat die externe Datenübertragung nicht freigegeben. Keine weitere externe Abfrage für diesen Auftrag ausführen.';
  try {
    const response = await fetch(`${input.baseUrl.replace(/\/$/, '')}/api/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(input.apiToken ? { authorization: `Bearer ${input.apiToken}` } : {}) },
      body: JSON.stringify({ call, ticket: approval.ticket, dashboardKey: input.dashboardKey, approved: true }),
      signal,
    });
    if (!response.ok) return 'Externe Abfrage nicht verfügbar oder nicht mehr freigegeben. Keine externen Ergebnisse erhalten.';
    const data = await response.json() as { content?: unknown };
    return typeof data.content === 'string' ? data.content.slice(0, 20_000) : 'Externe Quelle lieferte kein lesbares Ergebnis.';
  } catch {
    return signal?.aborted ? 'Externe Abfrage abgebrochen.' : 'Externe Quelle derzeit nicht erreichbar.';
  }
}