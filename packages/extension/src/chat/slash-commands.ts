import type { SlashCommand } from '@openvizpilot/shared';

/**
 * Slash-Befehle: Matching und Expansion. Die Befehlsliste selbst kommt von
 * AUSSEN (server-geladen via commands-client.ts, Fallback: DEFAULT_SLASH_COMMANDS
 * aus @openvizpilot/shared) — dieses Modul kennt nur noch die Mechanik, keine
 * Presets mehr. Die Expansion passiert rein clientseitig — der Chat zeigt den
 * Befehl, in die LLM-Historie geht der expandierte Prompt. Gespeicherte
 * Standardfragen dürfen Befehle enthalten; beim Senden werden sie erneut
 * expandiert.
 */

export interface ExpandedCommand {
  /** Was im Chat als User-Nachricht angezeigt wird (der Befehl selbst). */
  display: string;
  /** Was in die LLM-Historie geht (das expandierte Playbook). */
  prompt: string;
  /** Name des expandierten Befehls (für anonyme Nutzungsstatistik). */
  name: string;
}

/** Befehle, deren Name mit der Eingabe nach dem Slash beginnt (für das Menü). */
export function matchSlashCommands(commands: SlashCommand[], input: string): SlashCommand[] {
  if (!input.startsWith('/')) return [];
  const typed = input.slice(1).split(/\s/, 1)[0]?.toLowerCase() ?? '';
  return commands.filter((c) => c.name.startsWith(typed));
}

/**
 * Expandiert eine Eingabe wie "/vergleich Nord Süd". Unbekannte Befehle
 * ergeben null — die Eingabe wird dann als normaler Text gesendet.
 */
export function expandSlashCommand(commands: SlashCommand[], input: string): ExpandedCommand | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) return null;
  const [rawName, ...rest] = trimmed.slice(1).split(/\s+/);
  const command = commands.find((c) => c.name === rawName?.toLowerCase());
  if (!command) return null;
  const args = rest.join(' ').trim();
  const prompt = command.template.split('{{args}}').join(args || 'den relevanten Vergleichsgruppen');
  return { display: trimmed, prompt, name: command.name };
}
