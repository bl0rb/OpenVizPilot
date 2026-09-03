import {
  DEFAULT_SLASH_COMMANDS,
  MAX_DASHBOARD_KEY_CHARS,
  type DashboardAction,
  type SlashCommand,
  type Suggestions,
  type ToolCall,
  type ModelOption,
} from '@openvizpilot/shared';
// Personalisierung (User-Memory, gespeicherte eigene Abfragen) ist eine
// Enterprise-Funktion: Schema, Regeln und Client liegen in ee/.
import {
  addStandardQuestion,
  completeRedirectLogin,
  FOCUS_PRESETS,
  loadPrefs,
  savePrefs,
  type DashboardPrefs,
} from '@openvizpilot/ee/extension';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'preact/hooks';
import { ChatSession } from '../chat/agent-loop';
import { loadSlashCommands, sendUsageEvents } from '../chat/commands-client';
import { expandSlashCommand } from '../chat/slash-commands';
import { isAllowedBackendUrl, loadSettings, saveSettings, type ExtensionSettings } from '../settings';
import { executeDashboardAction } from '../tableau/actions';
import { getTableau, type Dashboard } from '../tableau/api';
import { buildContextSnapshot } from '../tableau/context-snapshot';
import { registerContextInvalidation } from '../tableau/events';
import { executeToolCall } from '../tools/registry';
import { Composer } from './Composer';
import { summarizeToolArgs, type ChatItem } from './items';
import { MessageList } from './MessageList';
import { SettingsPanel } from './SettingsPanel';
import type { AuthConfigResponse, AuthSession } from '@openvizpilot/shared';
import { clearSession, fetchAuthConfig, isAuthRequiredError, loadSession, logoutRemote, saveSession, validateSession } from '../chat/auth-session';
import { fetchFeatures, NO_EE_FEATURES, type EeFeatures } from '../chat/features-client';
import { LoginGate } from './LoginGate';

/** Ladezustand der Dashboard-Präferenzen — siehe Kommentar bei useState unten. */
type PrefsState = DashboardPrefs | null | 'loading' | 'unavailable';

let nextId = 1;

type Action =
  | { type: 'user'; text: string }
  | { type: 'round-start' }
  | { type: 'delta'; text: string }
  | { type: 'finalize'; text: string }
  | { type: 'suggestions'; suggestions: Suggestions }
  | {
      type: 'tool';
      callId: string;
      name: string;
      argsSummary?: string;
      status: 'running' | 'done';
      preview?: string;
    }
  | { type: 'notice'; text: string }
  | { type: 'error'; text: string; retryable: boolean }
  | { type: 'done' }
  | { type: 'clear' };

function reducer(items: ChatItem[], action: Action): ChatItem[] {
  switch (action.type) {
    case 'user':
      // Alte Vorschlags-Chips sind mit der neuen Frage obsolet.
      return [
        ...items.filter((i) => i.kind !== 'suggestions'),
        { kind: 'user', id: nextId++, text: action.text },
      ];
    case 'round-start':
      // Chips einer früheren Antwort verschwinden, sobald eine neue Runde
      // läuft (gilt auch für Retry, der keine 'user'-Action dispatcht).
      return [
        ...finalizeStreaming(items).filter((i) => i.kind !== 'suggestions'),
        { kind: 'assistant', id: nextId++, text: '', streaming: true },
      ];
    case 'delta': {
      const last = items[items.length - 1];
      if (last?.kind === 'assistant' && last.streaming) {
        return [...items.slice(0, -1), { ...last, text: last.text + action.text }];
      }
      return [...items, { kind: 'assistant', id: nextId++, text: action.text, streaming: true }];
    }
    case 'finalize': {
      // Gestreamten Text durch die bereinigte Endfassung ersetzen (der
      // <suggestions>-Block wird herausgeschnitten). Robust die LETZTE
      // Assistant-Bubble suchen — dahinter können bereits Notices liegen.
      for (let i = items.length - 1; i >= 0; i--) {
        const it = items[i];
        if (it?.kind === 'assistant') {
          const updated = [...items];
          updated[i] = { ...it, text: action.text, streaming: false };
          return updated;
        }
      }
      return items;
    }
    case 'suggestions':
      return [...items, { kind: 'suggestions', id: nextId++, suggestions: action.suggestions }];
    case 'tool': {
      const idx = items.findIndex((i) => i.kind === 'tool' && i.callId === action.callId);
      if (idx >= 0) {
        const updated = [...items];
        updated[idx] = {
          kind: 'tool',
          id: (items[idx] as ChatItem & { id: number }).id,
          callId: action.callId,
          name: action.name,
          argsSummary: action.argsSummary,
          status: action.status,
          preview: action.preview,
        };
        return updated;
      }
      return [
        ...finalizeStreaming(items),
        {
          kind: 'tool',
          id: nextId++,
          callId: action.callId,
          name: action.name,
          argsSummary: action.argsSummary,
          status: action.status,
          preview: action.preview,
        },
      ];
    }
    case 'notice':
      return [...items, { kind: 'notice', id: nextId++, text: action.text }];
    case 'error':
      return [...finalizeStreaming(items), { kind: 'error', id: nextId++, text: action.text, retryable: action.retryable }];
    case 'done':
      return finalizeStreaming(items);
    case 'clear':
      return [];
  }
}

function finalizeStreaming(items: ChatItem[]): ChatItem[] {
  return items.map((i) => (i.kind === 'assistant' && i.streaming ? { ...i, streaming: false } : i));
}

export function App(props: { dashboard: Dashboard }) {
  const { dashboard } = props;
  const [items, dispatch] = useReducer(reducer, []);
  const [busy, setBusy] = useState(false);
  const [settings, setSettings] = useState<ExtensionSettings>(() => loadSettings());
  // Enterprise-Login (OIDC): Auth-Modus der Middleware und die aktuelle
  // Sitzung (ID-Token, nur im sessionStorage) — siehe ee/extension.
  const [authConfig, setAuthConfig] = useState<AuthConfigResponse | null>(null);
  const [authSession, setAuthSession] = useState<AuthSession | null>(() => loadSession());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [defaultModel, setDefaultModel] = useState('');
  const [contextDirty, setContextDirty] = useState(false);
  // Zentral (Admin-UI) verwaltete Slash-Befehle — Fallback: eingebaute
  // Defaults, solange der Server nicht erreichbar ist oder nichts
  // konfiguriert hat (siehe commands-client.ts).
  const [commands, setCommands] = useState<SlashCommand[]>(DEFAULT_SLASH_COMMANDS);
  // Starter aus dem Admin-Playbook dieses Dashboards (vor den generischen).
  const [playbookStarters, setPlaybookStarters] = useState<string[]>([]);

  const session = useMemo(() => new ChatSession(), []);
  const snapshotRef = useRef<{ value: string | null; dirty: boolean }>({ value: null, dirty: true });
  const userId = useMemo(() => {
    try {
      return getTableau().extensions.environment.uniqueUserId ?? '';
    } catch {
      return '';
    }
  }, []);
  // Schlüssel für die Per-Dashboard-Präferenzen (Antwortfokus, Standardfragen)
  // — der Dashboard-Name reicht als Identifikator innerhalb eines Workbooks.
  const dashboardKey = useMemo(() => dashboard.name.slice(0, MAX_DASHBOARD_KEY_CHARS), [dashboard]);
  // 'loading' während des ersten Ladens, 'unavailable' ohne User-ID (keine
  // Personalisierung möglich — analog zum userId-Gate im Settings-Panel).
  const [prefs, setPrefs] = useState<PrefsState>(userId ? 'loading' : 'unavailable');

  useEffect(() => {
    const unregister = registerContextInvalidation(dashboard, () => {
      snapshotRef.current.dirty = true;
      setContextDirty(true);
    });
    return unregister;
  }, [dashboard]);

  // Ungültige (z. B. nicht-HTTPS-) Backend-URLs fallen sicher auf den
  // eigenen Origin zurück — siehe Vertrauensmodell in settings.ts.
  const baseUrl = isAllowedBackendUrl(settings.backendUrl).ok
    ? settings.backendUrl.trim().replace(/\/$/, '')
    : '';
  // Im OIDC-Modus ist das ID-Token der Bearer für alle API-Aufrufe; sonst
  // der optionale Shared-Token aus den Einstellungen.
  const apiToken = authSession?.token ?? settings.apiToken.trim();
  // Login-Gate: Modus mit Anmeldung, aber (noch) keine Sitzung.
  const needsLogin = (authConfig?.mode === 'oidc' || authConfig?.mode === 'local') && !authSession;
  // Freigeschaltete Enterprise-Funktionen (User-Memory, eigene Abfragen).
  const [features, setFeatures] = useState<EeFeatures>(NO_EE_FEATURES);
  // Daten erst laden, wenn die Anmeldung geklärt ist — sonst 401-Rauschen mit
  // veralteten Tokens, bevor das Gate überhaupt sichtbar ist.
  const authReady = authConfig !== null && !needsLogin;

  useEffect(() => {
    if (!authReady) return;
    let cancelled = false;
    void fetchFeatures(baseUrl, apiToken || undefined).then((next) => {
      if (!cancelled) setFeatures(next);
    });
    return () => {
      cancelled = true;
    };
  }, [baseUrl, apiToken, authReady]);

  useEffect(() => {
    let cancelled = false;
    void fetchAuthConfig(baseUrl).then((config) => {
      if (!cancelled) setAuthConfig(config);
    });
    return () => {
      cancelled = true;
    };
  }, [baseUrl]);

  const logout = useCallback(() => {
    if (authSession) logoutRemote(baseUrl, authSession.token);
    clearSession();
    setAuthSession(null);
  }, [authSession, baseUrl]);

  const onLoggedIn = useCallback((next: AuthSession) => {
    saveSession(next);
    setAuthSession(next);
  }, []);

  // Same-Window-SSO-Login (Popup blockiert) beim Start abschließen.
  const [loginError, setLoginError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    completeRedirectLogin({ baseUrl })
      .then((s) => {
        if (s && !cancelled) onLoggedIn(s);
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoginError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [baseUrl, onLoggedIn]);

  // Gespeicherte Sitzung beim Start gegen die Middleware prüfen (401 → Login-Gate).
  useEffect(() => {
    if (!authConfig || !authSession) return;
    if (authConfig.mode !== 'local' && authConfig.mode !== 'oidc') return;
    let cancelled = false;
    void validateSession(baseUrl, authSession.token).then((valid) => {
      if (!cancelled && !valid) logout();
    });
    return () => {
      cancelled = true;
    };
    // Nur beim Laden der Auth-Konfiguration bzw. Wechsel der Sitzung prüfen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authConfig, authSession?.token, baseUrl]);

  useEffect(() => {
    if (!authReady) return;
    let cancelled = false;
    fetch(`${baseUrl}/api/models`, {
      headers: apiToken ? { authorization: `Bearer ${apiToken}` } : {},
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data: { models: Array<ModelOption | string>; defaultModel: string }) => {
        if (cancelled) return;
        // Defensive Normalisierung: ein Server mit altem Stand liefert noch
        // string[] — beides auf {id, label} abbilden statt leer zu rendern.
        setModels(
          (Array.isArray(data.models) ? data.models : [])
            .map((m) => (typeof m === 'string' ? { id: m, label: m } : m))
            .filter((m) => m && typeof m.id === 'string' && typeof m.label === 'string'),
        );
        setDefaultModel(data.defaultModel);
      })
      .catch(() => {
        if (!cancelled) setModels([]);
      });
    return () => {
      cancelled = true;
    };
  }, [baseUrl, apiToken, authReady]);

  useEffect(() => {
    if (!authReady) return;
    let cancelled = false;
    void loadSlashCommands(baseUrl, apiToken || undefined, dashboardKey || undefined).then((loaded) => {
      if (cancelled) return;
      setCommands(loaded.commands);
      setPlaybookStarters(loaded.starters);
    });
    return () => {
      cancelled = true;
    };
  }, [baseUrl, apiToken, dashboardKey, authReady]);

  useEffect(() => {
    if (!userId || !authReady) return; // bleibt 'unavailable' — keine Personalisierung ohne User-ID
    // Ohne Enterprise-Lizenz für "savedQueries" gibt es keine gespeicherten
    // Abfragen: 'unavailable' schaltet Onboarding und Speichern konsistent ab.
    if (!features.savedQueries) {
      setPrefs('unavailable');
      return;
    }
    let cancelled = false;
    setPrefs('loading');
    void loadPrefs(baseUrl, apiToken || undefined, userId, dashboardKey).then((result) => {
      if (!cancelled) setPrefs(result);
    });
    return () => {
      cancelled = true;
    };
  }, [baseUrl, apiToken, userId, dashboardKey, authReady, features.savedQueries]);

  /** Schreibt Präferenzen optimistisch, macht bei Fehler den State-Update rückgängig. */
  const updatePrefs = useCallback(
    async (next: DashboardPrefs): Promise<string | null> => {
      if (!userId) return 'Keine Nutzer-ID verfügbar — Präferenzen können nicht gespeichert werden.';
      const previous = prefs;
      setPrefs(next);
      try {
        await savePrefs(baseUrl, apiToken || undefined, userId, dashboardKey, next);
        return null;
      } catch (err) {
        setPrefs(previous);
        return err instanceof Error ? err.message : 'Präferenzen konnten nicht gespeichert werden.';
      }
    },
    [userId, prefs, baseUrl, apiToken, dashboardKey],
  );

  const getContext = useCallback(async () => {
    if (snapshotRef.current.value === null || snapshotRef.current.dirty) {
      snapshotRef.current.value = await buildContextSnapshot(dashboard);
      snapshotRef.current.dirty = false;
      setContextDirty(false);
    }
    return snapshotRef.current.value;
  }, [dashboard]);

  const authorContext = settings.dashboardContext.trim() || undefined;
  // Nur ein tatsächlich gewählter Fokus (nicht 'loading'/'unavailable'/leer)
  // fließt in den System-Prompt.
  const answerFocus = typeof prefs === 'object' && prefs !== null && prefs.focus ? prefs.focus : undefined;

  const runTurn = useCallback(
    (userText: string | null) => {
      setBusy(true);
      void session
        .runTurn(
          userText,
          {
            backendUrl: baseUrl,
            apiToken: apiToken || undefined,
            model: settings.model || undefined,
            userId: userId || undefined,
            authorContext,
            answerFocus,
            dashboardKey: dashboardKey || undefined,
            getContext,
            executeTool: (call: ToolCall) => executeToolCall(call, dashboard),
          },
          {
            onRoundStart: () => dispatch({ type: 'round-start' }),
            onAssistantDelta: (text) => dispatch({ type: 'delta', text }),
            onAssistantFinal: (text) => dispatch({ type: 'finalize', text }),
            onSuggestions: (suggestions) => dispatch({ type: 'suggestions', suggestions }),
            onToolRun: (info) =>
              dispatch({
                type: 'tool',
                callId: info.id,
                name: info.name,
                argsSummary: summarizeToolArgs(info.argsJson),
                status: info.status,
                preview: info.resultPreview,
              }),
            onNotice: (text) => dispatch({ type: 'notice', text }),
            onError: (text, retryable) => {
              // Abgelaufene/ungültige SSO-Sitzung: zurück zum Login statt Retry-Schleife.
              if (isAuthRequiredError(text)) logout();
              dispatch({ type: 'error', text, retryable });
            },
            onDone: (data) => {
              dispatch({ type: 'done' });
              if (data.finishReason === 'length') {
                dispatch({ type: 'notice', text: 'Antwort wurde wegen Längenlimit abgeschnitten.' });
              }
            },
          },
        )
        .finally(() => setBusy(false));
    },
    [session, baseUrl, apiToken, settings.model, userId, authorContext, answerFocus, getContext, dashboard, logout],
  );

  const send = useCallback(
    (text: string) => {
      // '★ '-Präfix ist reine Anzeige der Standardfrage-Chips (siehe
      // `starters` unten) — es ist nicht Teil der eigentlichen Frage.
      const clean = text.startsWith('★ ') ? text.slice(2) : text;
      // Slash-Befehle: der Chat zeigt den Befehl, in die LLM-Historie geht
      // das expandierte deutsche Prompt-Playbook. Unbekannte "/…"-Eingaben
      // werden als normaler Text gesendet.
      const expanded = expandSlashCommand(commands, clean);
      dispatch({ type: 'user', text: expanded ? expanded.display : clean });
      runTurn(expanded ? expanded.prompt : clean);
      if (expanded) {
        sendUsageEvents(baseUrl, apiToken || undefined, [{ metric: 'slash_command', key: expanded.name }]);
      }
    },
    [runTurn, commands, baseUrl, apiToken],
  );

  const stop = useCallback(() => {
    session.stop();
    dispatch({ type: 'done' });
    dispatch({ type: 'notice', text: 'Abgebrochen.' });
  }, [session]);

  // Vom LLM VORGESCHLAGENE Aktion — Ausführung ausschließlich hier,
  // nach explizitem User-Klick (Human-in-the-Loop, siehe tableau/actions.ts).
  const runDashboardAction = useCallback(
    (action: DashboardAction) => {
      if (busy) return;
      void executeDashboardAction(action, dashboard)
        .then((message) => {
          dispatch({ type: 'notice', text: message });
          sendUsageEvents(baseUrl, apiToken || undefined, [{ metric: 'action_executed', key: action.type }]);
        })
        .catch((err: unknown) =>
          dispatch({
            type: 'notice',
            text: `Aktion fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`,
          }),
        );
    },
    [busy, dashboard, baseUrl, apiToken],
  );

  // Vorschlagsfragen für den leeren Zustand — client-seitig, ohne LLM-Call.
  // Reihenfolge: vom User gespeicherte Standardfragen (★-Präfix), dann die
  // Starter aus dem Admin-Playbook dieses Dashboards, dann generische
  // Vorschläge — insgesamt max. 6 Chips, ohne Dubletten.
  const starters = useMemo(() => {
    const names = dashboard.worksheets.map((w) => w.name);
    const generic = [
      'Fasse das Dashboard kurz zusammen.',
      'Was fällt in den Daten auf? Nenne die drei wichtigsten Punkte.',
      'Welche Filter sind gerade aktiv?',
      ...names.slice(0, 2).map((n) => `Was zeigt „${n}"?`),
    ];
    const savedQuestions = typeof prefs === 'object' && prefs !== null ? prefs.questions : [];
    const seen = new Set(savedQuestions.map((q) => q.trim()));
    const dedupe = (list: string[]) =>
      list.filter((q) => {
        const key = q.trim();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    return [
      ...savedQuestions.map((q) => `★ ${q}`),
      ...dedupe(playbookStarters),
      ...dedupe(generic),
    ].slice(0, 6);
  }, [dashboard, prefs, playbookStarters]);

  // Speichert eine gestellte Frage als Standardfrage für dieses Dashboard
  // (☆-Button an jeder User-Message, siehe MessageList). undefined ohne
  // User-ID oder ohne Enterprise-Lizenz für "savedQueries" — dann erscheint der
  // Button gar nicht erst, statt beim Speichern an einer 402 zu scheitern.
  const onSaveStandard = useMemo(() => {
    if (!userId || !features.savedQueries) return undefined;
    return (text: string) => {
      const current: DashboardPrefs =
        typeof prefs === 'object' && prefs !== null ? prefs : { focus: '', questions: [] };
      // Duplikat-, Höchstzahl- und Kürzungsregeln gehören zur lizenzpflichtigen
      // Funktion und stehen deshalb in ee/.
      const result = addStandardQuestion(current, text);
      if (!result.prefs) {
        dispatch({ type: 'notice', text: result.notice });
        return;
      }
      void updatePrefs(result.prefs).then((err) => {
        dispatch({ type: 'notice', text: err ?? result.notice });
        if (!err) {
          sendUsageEvents(baseUrl, apiToken || undefined, [{ metric: 'standard_question_saved', key: 'saved' }]);
        }
      });
    };
  }, [userId, features.savedQueries, prefs, updatePrefs, baseUrl, apiToken]);

  // ONBOARDING: Beim ersten Öffnen eines Dashboards (leerer Chat, noch kein
  // Fokus gewählt) fragt die Extension zuerst nach dem Antwortfokus — erst
  // danach erscheinen die normalen Starter-Chips (siehe MessageList).
  const showFocusOnboarding =
    items.length === 0 && prefs !== 'loading' && prefs !== 'unavailable' && (prefs === null || prefs.focus === '');

  const onPickFocus = useCallback(
    (focus: string) => {
      const questions = typeof prefs === 'object' && prefs !== null ? prefs.questions : [];
      void updatePrefs({ focus, questions }).then((err) =>
        dispatch({ type: 'notice', text: err ?? 'Antwortfokus für dieses Dashboard gespeichert.' }),
      );
    },
    [prefs, updatePrefs],
  );

  const onSkipFocus = useCallback(() => {
    const questions = typeof prefs === 'object' && prefs !== null ? prefs.questions : [];
    void updatePrefs({ focus: '', questions }).then((err) =>
      dispatch({ type: 'notice', text: err ?? 'Ohne Fokus gestartet.' }),
    );
  }, [prefs, updatePrefs]);

  const copyTranscript = useCallback(() => {
    const lines: string[] = [`# OpenVizPilot — ${dashboard.name}`, ''];
    for (const item of items) {
      if (item.kind === 'user') lines.push(`**Frage:** ${item.text}`, '');
      else if (item.kind === 'assistant' && item.text) lines.push(item.text, '');
      else if (item.kind === 'tool') {
        lines.push(`> Analyse-Schritt: ${item.name}${item.argsSummary ? ` (${item.argsSummary})` : ''}`, '');
      }
    }
    const markdown = lines.join('\n');
    const fallbackCopy = (): boolean => {
      const ta = document.createElement('textarea');
      ta.value = markdown;
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try {
        ok = document.execCommand('copy');
      } catch {
        ok = false;
      }
      ta.remove();
      return ok;
    };
    const report = (ok: boolean) =>
      dispatch({
        type: 'notice',
        text: ok
          ? 'Verlauf als Markdown kopiert.'
          : 'Kopieren fehlgeschlagen — bitte Text manuell markieren.',
      });
    try {
      void navigator.clipboard
        .writeText(markdown)
        .then(() => report(true))
        .catch(() => report(fallbackCopy()));
    } catch {
      report(fallbackCopy());
    }
  }, [items, dashboard]);

  const onSaveSettings = useCallback(async (next: ExtensionSettings) => {
    setSettings(next);
    const result = await saveSettings(next);
    return result.message ?? null;
  }, []);


  return (
    <div class="app">
      <header class="header">
        <span class="title" title={dashboard.name}>
          OpenVizPilot
        </span>
        {contextDirty && (
          <span class="context-hint" title="Der Dashboard-Kontext wird beim nächsten Senden aktualisiert.">
            Dashboard geändert
          </span>
        )}
        {items.length > 0 && (
          <button
            type="button"
            class="btn-icon"
            title="Verlauf als Markdown kopieren"
            disabled={busy}
            onClick={copyTranscript}
          >
            ⧉
          </button>
        )}
        {authSession && (
          <button
            type="button"
            class="btn-icon"
            title={`Abmelden${authSession.user.name || authSession.user.email ? ` (${authSession.user.name ?? authSession.user.email})` : ''}`}
            onClick={logout}
          >
            ⎋
          </button>
        )}
        <button
          type="button"
          class="btn-icon"
          title="Einstellungen"
          onClick={() => setSettingsOpen((v) => !v)}
        >
          ⚙
        </button>
      </header>
      {settingsOpen ? (
        <SettingsPanel
          settings={settings}
          models={models}
          defaultModel={defaultModel}
          backendUrl={baseUrl}
          apiToken={apiToken}
          userId={userId}
          prefs={prefs}
          features={features}
          onSave={onSaveSettings}
          onSavePrefs={updatePrefs}
          onClose={() => setSettingsOpen(false)}
        />
      ) : needsLogin && authConfig ? (
        // Einstellungen bleiben auch vor der Anmeldung erreichbar (z. B. falsche Backend-URL).
        <LoginGate baseUrl={baseUrl} config={loginError ? { ...authConfig, error: loginError } : authConfig} onLoggedIn={onLoggedIn} />
      ) : (
        <>
          <MessageList
            items={items}
            busy={busy}
            starters={starters}
            onboarding={
              showFocusOnboarding
                ? { presets: FOCUS_PRESETS, onPick: onPickFocus, onSkip: onSkipFocus }
                : undefined
            }
            onRetry={() => {
              if (!busy) runTurn(null);
            }}
            onSend={send}
            onAction={runDashboardAction}
            onSaveStandard={onSaveStandard}
          />
          <Composer busy={busy} disabled={false} commands={commands} onSend={send} onStop={stop} />
        </>
      )}
    </div>
  );
}
