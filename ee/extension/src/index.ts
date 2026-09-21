/**
 * OpenVizPilot Enterprise Edition — Stub für den Core-Export.
 *
 * Ersetzt `ee/extension/src/index.ts` in `bl0rb/OpenVizPilot` (siehe
 * scripts/core-export.sh). Exportiert exakt die Werte und Typen, die die
 * Extension (packages/extension/src/ui/{App,LoginGate,SettingsPanel}.tsx)
 * tatsächlich importiert — abgeleitet per
 * `grep -rn "@openvizpilot/ee" packages/`. Panels, die eine Enterprise-Lizenz
 * voraussetzen, rendern nichts (`null`); Netzwerk-Clients liefern das
 * "nichts gespeichert/nicht verfügbar"-Ergebnis, ohne die Middleware
 * anzusprechen — der Kern ruft sie ohnehin nur auf, wenn `/api/features` das
 * jeweilige Feature freigibt, was in der Core-Edition nie der Fall ist.
 *
 * Muss zur öffentlichen API von ee/extension/src/index.ts passen — Drift
 * fällt in der Enterprise-CI (Export-Workflow) auf, nicht hier.
 */
import { t, type AuthConfigResponse, type AuthSession } from '@openvizpilot/shared';
import { h } from 'preact';

/** Unterscheidet den Stub (öffentliches Repo) vom echten ee/ (privates Repo). */
export const EE_STUB = true as const;

// ------------------------------------------------------------------ OIDC ----

/** Ohne Enterprise-Edition gibt es kein IdP, an das ein Fragment zurückkehren könnte. */
export async function completeRedirectLogin(_deps: { baseUrl: string; fetchImpl?: typeof fetch }): Promise<AuthSession | null> {
  return null;
}

/** Single Sign-On ist eine Enterprise-Funktion — die Core-Edition zeigt nur den Hinweis. */
export function LoginPanel(props: { baseUrl: string; config: AuthConfigResponse; onLoggedIn: (session: AuthSession) => void }) {
  return h('div', { class: 'login-panel' }, [
    h('h2', { key: 'h' }, t('login.required')),
    h('p', { class: 'memory-hint', key: 'p' }, 'Single Sign-On ist eine Enterprise-Funktion — siehe docs/enterprise.md.'),
  ]);
}

// ---------------------------------------------------------- Personalisierung

export interface DashboardPrefs {
  focus: string;
  questions: string[];
}

/** Vorgefertigte Fokus-Optionen: ohne Lizenz gibt es nichts zum Vorschlagen. */
export const FOCUS_PRESETS: string[] = [];

const MAX_STANDARD_QUESTIONS = 5;
const MAX_QUESTION_CHARS = 200;

/**
 * Reine, lizenzunabhängige Formularlogik (Dubletten-/Höchstzahl-Prüfung) —
 * identisch zu ee/server/src/personalization-schema.ts. Der Kern zeigt das
 * zugehörige UI ohnehin nur, wenn `/api/features` `savedQueries` freigibt,
 * was ohne Lizenz nie geschieht; die Middleware speichert nichts ohne sie.
 */
export function addStandardQuestion(current: DashboardPrefs, text: string): { prefs?: DashboardPrefs; notice: string } {
  const question = text.slice(0, MAX_QUESTION_CHARS);
  if (current.questions.includes(question)) {
    return { notice: 'Diese Frage ist schon als Standardfrage gespeichert.' };
  }
  if (current.questions.length >= MAX_STANDARD_QUESTIONS) {
    return { notice: `Maximal ${MAX_STANDARD_QUESTIONS} Standardfragen pro Dashboard — lösche zuerst eine in den Einstellungen.` };
  }
  return { prefs: { ...current, questions: [...current.questions, question] }, notice: 'Als Standardfrage gespeichert.' };
}

/** User-Memory ist eine Enterprise-Funktion — die Core-Edition zeigt nichts. */
export function MemoryFactsPanel(_props: { backendUrl: string; apiToken: string; userId: string; licensed: boolean }) {
  return null;
}

/** Gespeicherte eigene Abfragen sind eine Enterprise-Funktion — die Core-Edition zeigt nichts. */
export function SavedQueriesPanel(_props: {
  prefs: DashboardPrefs | null | 'loading' | 'unavailable' | 'error';
  onSavePrefs: (prefs: DashboardPrefs) => Promise<string | null>;
  onReloadPrefs: () => void;
}) {
  return null;
}

/** Ohne Lizenz sind nie eigene Abfragen gespeichert — `/api/features` blendet den Aufrufer ohnehin aus. */
export async function loadPrefs(_baseUrl: string, _apiToken: string | undefined, _userId: string, _dashboardKey: string): Promise<DashboardPrefs | null> {
  return null;
}

/** Ohne Lizenz gibt es nichts zu speichern — der Aufrufer wird durch `/api/features` bereits ausgeblendet. */
export async function savePrefs(_baseUrl: string, _apiToken: string | undefined, _userId: string, _dashboardKey: string, _prefs: DashboardPrefs): Promise<void> {
  /* no-op */
}

// --------------------------------------------------------------- Tools -----

/** MCP-Quellen sind eine Enterprise-Funktion — kein Aufruf an die Middleware. */
export async function executeMcpTool(_input: {
  call: unknown;
  approval?: unknown;
  dashboardKey: string;
  baseUrl: string;
  apiToken?: string;
  signal?: AbortSignal;
  confirm: (message: string) => boolean;
}): Promise<string> {
  return 'Nicht verfügbar in der Core-Edition.';
}

/** Der Tableau-Server-Connector ist eine Enterprise-Funktion — kein Aufruf an die Middleware. */
export async function executeTableauTool(_input: { call: unknown; baseUrl: string; apiToken?: string; dashboardKey?: string; signal?: AbortSignal }): Promise<string> {
  return 'Nicht verfügbar in der Core-Edition.';
}
