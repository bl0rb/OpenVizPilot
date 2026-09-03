import { z } from 'zod';
import { MAX_DASHBOARD_KEY_CHARS } from './prefs';
import { slashCommandListSchema, type SlashCommand } from './slash-commands';

/**
 * Playbooks pro Dashboard: Der Admin hinterlegt je Dashboard (Schlüssel =
 * Dashboard-Name, wie bei den Präferenzen) eigene Starter-Fragen und
 * Slash-Befehle. Die Extension lädt sie beim Start für das geöffnete
 * Dashboard (GET /api/commands?dashboardKey=…) — Starter erscheinen vor den
 * generischen Vorschlägen, Dashboard-Befehle überlagern gleichnamige globale.
 */

export const MAX_PLAYBOOK_STARTERS = 5;
export const MAX_PLAYBOOK_STARTER_CHARS = 200;

export const dashboardPlaybookSchema = z.object({
  starters: z.array(z.string().min(1).max(MAX_PLAYBOOK_STARTER_CHARS)).max(MAX_PLAYBOOK_STARTERS),
  commands: slashCommandListSchema,
});

export type DashboardPlaybook = z.infer<typeof dashboardPlaybookSchema>;

/** Body von PUT /api/admin/playbooks. */
export const playbookEntrySchema = z.object({
  dashboardKey: z.string().min(1).max(MAX_DASHBOARD_KEY_CHARS),
  playbook: dashboardPlaybookSchema,
});

export type PlaybookEntry = z.infer<typeof playbookEntrySchema>;

/**
 * Dashboard-Befehle überlagern globale mit demselben Namen; die Gesamtliste
 * bleibt unter MAX_SLASH_COMMANDS (Dashboard-Befehle haben Vorrang).
 */
export function mergeCommands(global: SlashCommand[], dashboard: SlashCommand[]): SlashCommand[] {
  const names = new Set(dashboard.map((c) => c.name));
  return [...dashboard, ...global.filter((c) => !names.has(c.name))].slice(0, 20);
}
