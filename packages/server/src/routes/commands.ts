import { DEFAULT_SLASH_COMMANDS, mergeCommands } from '@openvizpilot/shared';
import { Hono } from 'hono';
import type { Logger } from '../logger';
import type { MemoryStore } from '../memory/store';

/**
 * Öffentlicher Read-Endpoint für die zentral (Admin-UI) verwalteten
 * Slash-Befehle — von der Extension beim Start geladen (siehe
 * extension/src/chat/commands-client.ts). Läuft unter dem normalen
 * API_AUTH_TOKEN-Regime wie /api/chat (siehe app.ts), NICHT unter dem
 * separaten Admin-Token.
 *
 * Fällt bei jedem Fehler (Store fehlt, Datenbank nicht erreichbar,
 * ungültiger gespeicherter Wert) still auf die eingebauten Defaults zurück
 * statt einen Fehlerstatus zu liefern — die Extension bleibt so ohne aktive
 * Admin-Konfiguration voll funktionsfähig.
 */
export function createCommandsRoute(memoryStore: MemoryStore | null, logger: Logger): Hono {
  const app = new Hono();

  // ?dashboardKey=… liefert zusätzlich das Dashboard-Playbook (Starter +
  // überlagernde Befehle, siehe @openvizpilot/shared/playbooks.ts).
  app.get('/', async (c) => {
    const dashboardKey = c.req.query('dashboardKey')?.trim() || null;
    if (!memoryStore) {
      return c.json({ commands: DEFAULT_SLASH_COMMANDS, starters: [] });
    }
    try {
      const stored = await memoryStore.getSlashCommands();
      const global = stored ?? DEFAULT_SLASH_COMMANDS;
      const playbook = dashboardKey ? await memoryStore.getPlaybook(dashboardKey) : null;
      return c.json({
        commands: playbook ? mergeCommands(global, playbook.commands) : global,
        starters: playbook?.starters ?? [],
      });
    } catch (err) {
      logger.warn('commands read failed, falling back to defaults', {
        name: err instanceof Error ? err.name : 'unknown',
      });
      return c.json({ commands: DEFAULT_SLASH_COMMANDS, starters: [] });
    }
  });

  return app;
}
