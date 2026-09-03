import { isToolName, toolArgSchemas, truncateText, type ToolCall } from '@openvizpilot/shared';
import type { Dashboard } from '../tableau/api';
import { executors } from './executors/index';

/** Harte Obergrenze pro Tool-Ergebnis, damit die Historie nicht explodiert. */
export const MAX_TOOL_RESULT_CHARS = 20_000;

/**
 * Führt einen Tool-Call aus. Wirft NIE — jeder Fehler wird als Text-Ergebnis
 * zurückgegeben, damit das LLM sich selbst korrigieren kann und der Turn
 * nicht abbricht.
 */
export async function executeToolCall(call: ToolCall, dashboard: Dashboard): Promise<string> {
  const name = call.function.name;
  if (!isToolName(name)) {
    return `Fehler: Unbekanntes Tool "${name}".`;
  }

  let parsedArgs: unknown;
  try {
    parsedArgs = call.function.arguments.trim() === '' ? {} : JSON.parse(call.function.arguments);
  } catch {
    return `Fehler: Argumente für "${name}" sind kein gültiges JSON.`;
  }

  const schema = toolArgSchemas[name];
  const validation = schema.safeParse(parsedArgs);
  if (!validation.success) {
    const issues = validation.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    return `Fehler: Ungültige Argumente für "${name}": ${issues}`;
  }

  try {
    // validation.data ist durch das jeweilige Schema getypt; der Executor passt per Konstruktion.
    const executor = executors[name] as (args: unknown, dashboard: Dashboard) => Promise<string>;
    const result = await executor(validation.data, dashboard);
    return truncateText(result, MAX_TOOL_RESULT_CHARS);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return `Fehler bei "${name}": ${message}`;
  }
}
