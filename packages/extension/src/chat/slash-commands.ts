import type { SlashCommand } from '@openvizpilot/shared';

/**
 * Slash commands: matching and expansion. The command list itself comes from
 * outside (server-loaded via commands-client.ts, fallback: DEFAULT_SLASH_COMMANDS
 * from @openvizpilot/shared) — this module only knows the mechanics, not the presets.
 * Expansion happens purely client-side — the chat shows the command, while the
 * expanded prompt goes into the LLM history. Saved starter questions may contain
 * commands; when they are sent, they are expanded again.
 */

export interface ExpandedCommand {
  /** What is shown in the chat as a user message (the command itself). */
  display: string;
  /** What goes into the LLM history (the expanded playbook prompt). */
  prompt: string;
  /** Name of the expanded command (for anonymous usage stats). */
  name: string;
}

/** Commands whose name begins with the text after the slash (for the menu). */
export function matchSlashCommands(commands: SlashCommand[], input: string): SlashCommand[] {
  if (!input.startsWith('/')) return [];
  const typed = input.slice(1).split(/\s/, 1)[0]?.toLowerCase() ?? '';
  return commands.filter((c) => c.name.startsWith(typed));
}

/**
 * Expands an input such as "/vergleich Nord Süd". Unknown commands return null,
 * which means the input is sent as plain text.
 */
export function expandSlashCommand(commands: SlashCommand[], input: string): ExpandedCommand | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) return null;
  const [rawName, ...rest] = trimmed.slice(1).split(/\s+/);
  const command = commands.find((c) => c.name === rawName?.toLowerCase());
  if (!command) return null;
  const args = rest.join(' ').trim();
  const fallbackArgs = command.name === 'compare' ? 'the relevant comparison groups' : 'den relevanten Vergleichsgruppen';
  const prompt = command.template.split('{{args}}').join(args || fallbackArgs);
  return { display: trimmed, prompt, name: command.name };
}
