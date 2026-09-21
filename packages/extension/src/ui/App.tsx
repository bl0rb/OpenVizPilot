import {
  DEFAULT_SLASH_COMMANDS,
  MAX_DASHBOARD_KEY_CHARS,
  t,
  type ChatMode,
  type DashboardAction,
  type SlashCommand,
  type ToolCall,
  type ModelOption,
} from '@openvizpilot/shared';
// Personalisierung (User-Memory, gespeicherte eigene Abfragen) ist eine
// Enterprise-Funktion: Schema, Regeln und Client liegen in ee/.
import {
  addStandardQuestion,
  completeRedirectLogin,
  createWatchRule,
  FOCUS_PRESETS,
  loadPrefs,
  savePrefs,
  type DashboardPrefs,
  type WatchRuleProposal,
} from '@openvizpilot/ee/extension';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'preact/hooks';
import { ChatSession } from '../chat/agent-loop';
import { ensureDashboardKey, registerDashboard } from '../tableau/dashboard-registration';
import { loadSlashCommands, sendUsageEvents } from '../chat/commands-client';
import { expandSlashCommand } from '../chat/slash-commands';
import { isAllowedBackendUrl, loadSettings, saveSettings, type ExtensionSettings } from '../settings';
import { executeDashboardAction } from '../tableau/actions';
import { getTableau, type Dashboard } from '../tableau/api';
import { buildContextSnapshot } from '../tableau/context-snapshot';
import { describeContextChange, registerContextInvalidation } from '../tableau/events';
import { executeToolCall } from '../tools/registry';
import { createServerDataConsentGate, executeMcpTool, executeTableauTool, ServerDataConsentDialog } from '@openvizpilot/ee/extension';
import { setConfigureHandler } from '../main';
import { reducer } from './chat-reducer';
import { Composer } from './Composer';
import { summarizeToolArgs } from './items';
import { MessageList } from './MessageList';
import { SettingsPanel } from './SettingsPanel';
import type { AuthConfigResponse, AuthSession } from '@openvizpilot/shared';
import { clearSession, fetchAuthConfig, fetchUserAccess, isAuthRequiredError, loadSession, logoutRemote, saveSession, type UserAccess } from '../chat/auth-session';
import { fetchFeatures, NO_EE_FEATURES, type EeFeatures } from '../chat/features-client';
import { LoginGate } from './LoginGate';

/** Ladezustand der Dashboard-Präferenzen — siehe Kommentar bei useState unten. */
type PrefsState = DashboardPrefs | null | 'loading' | 'unavailable' | 'error';

/** localStorage-Key für den zuletzt gewählten Chat-Modus (Fragen/Untersuchen, W3). */
const MODE_STORAGE_KEY = 'openvizpilot.chatMode';

export function App(props: { dashboard: Dashboard }) {
  const { dashboard } = props;
  const [items, dispatch] = useReducer(reducer, []);
  const [busy, setBusy] = useState(false);
  // Fragen vs. Untersuchen (W3) — Session-Zustand, optional über localStorage
  // gemerkt (wie andere reine Viewer-Präferenzen); scheitert das (privates
  // Fenster, deaktiviertes Storage), gilt einfach der Default 'ask'.
  const [mode, setModeState] = useState<ChatMode>(() => {
    try {
      const stored = localStorage.getItem(MODE_STORAGE_KEY);
      // 'investigate-estate' (W7) braucht bei jedem Start erneut features.serverData —
      // die Prüfung passiert weiter unten (siehe Effekt bei geladenen features).
      return stored === 'investigate' || stored === 'investigate-estate' ? stored : 'ask';
    } catch {
      return 'ask';
    }
  });
  const setMode = useCallback((next: ChatMode) => {
    setModeState(next);
    try {
      localStorage.setItem(MODE_STORAGE_KEY, next);
    } catch {
      // localStorage nicht verfügbar — Modus gilt nur für diese Sitzung.
    }
  }, []);
  const [settings, setSettings] = useState<ExtensionSettings>(() => loadSettings());
  // Enterprise-Login (OIDC): Auth-Modus der Middleware und die aktuelle
  // Sitzung (ID-Token, nur im sessionStorage) — siehe ee/extension.
  const [authConfig, setAuthConfig] = useState<AuthConfigResponse | null>(null);
  const [authSession, setAuthSession] = useState<AuthSession | null>(() => loadSession());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [defaultModel, setDefaultModel] = useState('');
  const [contextDirty, setContextDirty] = useState(false);
  // Klartext der letzten Kontextänderung („Filter ‚Region' geändert") und das
  // Worksheet, in dem der Anwender zuletzt etwas markiert hat.
  const [contextChange, setContextChange] = useState<string | null>(null);
  const [selectionIn, setSelectionIn] = useState<string | null>(null);
  /** Merkt sich, dass die nächste Markierung von einem eigenen Action-Chip stammt. */
  const ownSelectionRef = useRef(false);
  // Einwilligung „Serverseitiger Datenzugriff" (tableau_view_data, W5): der
  // Dialog wird höchstens einmal je Sitzung gezeigt (siehe ServerDataConsent),
  // auch wenn mehrere Tool-Aufrufe im selben Turn dieselbe Zustimmung brauchen.
  const [consentPrompt, setConsentPrompt] = useState<{ message: string; resolve: (accepted: boolean) => void } | null>(null);
  const showServerDataConsentDialog = useCallback(
    (message: string) => new Promise<boolean>((resolve) => setConsentPrompt({ message, resolve })),
    [],
  );
  const consentGateRef = useRef(createServerDataConsentGate(showServerDataConsentDialog));
  // Zentral (Admin-UI) verwaltete Slash-Befehle — Fallback: eingebaute
  // Defaults, solange der Server nicht erreichbar ist oder nichts
  // konfiguriert hat (siehe commands-client.ts).
  const [commands, setCommands] = useState<SlashCommand[]>(DEFAULT_SLASH_COMMANDS);
  // Starter aus dem Admin-Playbook dieses Dashboards (vor den generischen).
  const [playbookStarters, setPlaybookStarters] = useState<string[]>([]);
  const [playbookKey, setPlaybookKey] = useState<string | null>(null);
  const [registrationMessage, setRegistrationMessage] = useState(t('app.registration.loading'));

  useEffect(() => {
    let cancelled = false;
    void ensureDashboardKey().then((key) => {
      if (cancelled) return;
      setPlaybookKey(key);
      if (!key) setRegistrationMessage(t('app.registration.dashboardCopyHint'));
    }).catch(() => {
      if (!cancelled) setRegistrationMessage(t('app.registration.saveFailed'));
    });
    return () => { cancelled = true; };
  }, [dashboard]);

  const session = useMemo(() => new ChatSession(), []);
  const snapshotRef = useRef<{ value: string | null; dirty: boolean }>({ value: null, dirty: true });
  const userId = useMemo(() => {
    try {
      return getTableau().extensions.environment.uniqueUserId ?? '';
    } catch {
      return '';
    }
  }, []);
  // Autorenmodus: gemeinsame Workbook-Konfiguration (Backend-URL, API-Token,
  // Dashboard-Kontext, Zuordnungs-Reset) ist nur für Autoren sichtbar/änderbar
  // — siehe SettingsPanel.tsx. Persönliche Einstellungen bleiben für alle da.
  const isAuthor = useMemo(() => {
    try {
      return getTableau().extensions.environment.mode === 'authoring';
    } catch {
      return false;
    }
  }, []);
  // Schlüssel für die Per-Dashboard-Präferenzen (Antwortfokus, Standardfragen)
  // — der Dashboard-Name reicht als Identifikator innerhalb eines Workbooks.
  const dashboardKey = useMemo(() => dashboard.name.slice(0, MAX_DASHBOARD_KEY_CHARS), [dashboard]);
  // 'loading' während des ersten Ladens, 'unavailable' ohne User-ID (keine
  // Personalisierung möglich — analog zum userId-Gate im Settings-Panel),
  // 'error' bei einem Lade-Fehlschlag (siehe reloadPrefs unten).
  const [prefs, setPrefs] = useState<PrefsState>(userId ? 'loading' : 'unavailable');
  // Erhöht sich bei jedem manuellen "Erneut laden" — löst den Lade-Effekt
  // unten erneut aus (siehe reloadPrefs).
  const [prefsReloadToken, setPrefsReloadToken] = useState(0);

  useEffect(() => {
    const unregister = registerContextInvalidation(dashboard, {
      onDirty: (change) => {
        snapshotRef.current.dirty = true;
        setContextDirty(true);
        setContextChange(describeContextChange(change));
      },
      // Eine Markierung verwirft den Kontext nicht — sie bietet nur an, sie
      // auszuwerten (der Snapshot enthält Markierungen ohnehin nicht). Was der
      // Assistent selbst markiert hat, muss er dem Nutzer aber nicht als
      // „deine Auswahl" zum Auswerten anbieten.
      onSelection: (worksheetName) => {
        if (ownSelectionRef.current) {
          ownSelectionRef.current = false;
          return;
        }
        setSelectionIn(worksheetName);
      },
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
  // Solange die Enterprise-Features noch nicht geladen sind, ist `features.serverData`
  // vorläufig `false` (Default) — ohne dieses Flag würde der Downgrade-Effekt unten ein
  // persistiertes 'investigate-estate' bei jedem Start fälschlich zurückstufen, bevor der
  // Feature-Fetch überhaupt geantwortet hat.
  const [featuresLoaded, setFeaturesLoaded] = useState(false);
  const [accessState, setAccessState] = useState<{ key: string; value?: UserAccess; error?: string } | null>(null);
  const [accessReload, setAccessReload] = useState(0);
  const accessKey = JSON.stringify([baseUrl, apiToken]);
  const access = accessState?.key === accessKey ? accessState.value : undefined;
  // Daten erst laden, wenn die Anmeldung geklärt ist — sonst 401-Rauschen mit
  // veralteten Tokens, bevor das Gate überhaupt sichtbar ist.
  const authReady = authConfig !== null && !needsLogin && access?.ai === true;

  useEffect(() => {
    if (!authReady) return;
    let cancelled = false;
    void fetchFeatures(baseUrl, apiToken || undefined).then((next) => {
      if (!cancelled) {
        setFeatures(next);
        setFeaturesLoaded(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [baseUrl, apiToken, authReady, access?.tableauApi]);

  // Umgebungsweite Untersuchung (W7) braucht features.serverData — fällt die
  // Freigabe/Lizenz zwischen Sitzungen weg, aber ein alter localStorage-Wert
  // steht noch auf 'investigate-estate', sonst würde jede Runde serverseitig
  // zurückgestuft, ohne dass die Umschalter-UI das je anzeigt.
  useEffect(() => {
    if (featuresLoaded && mode === 'investigate-estate' && !features.serverData) setMode('investigate');
  }, [mode, features.serverData, featuresLoaded, setMode]);

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

  // The same authenticated endpoint reports session validity and current grants.
  useEffect(() => {
    if (!authConfig || needsLogin) return;
    let cancelled = false;
    const controller = new AbortController();
    const refresh = async () => {
      try {
        const value = await fetchUserAccess(baseUrl, apiToken, controller.signal);
        if (cancelled) return;
        setAccessState({ key: accessKey, value });
        if (!value.ai) { session.stop(); setFeatures(NO_EE_FEATURES); }
      } catch (error) {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : t('app.access.statusUnavailable');
        setAccessState({ key: accessKey, error: message });
        session.stop();
        setFeatures(NO_EE_FEATURES);
        if (isAuthRequiredError(message)) logout();
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 30_000);
    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(timer);
    };
  }, [authConfig, needsLogin, accessKey, accessReload, logout, session]);

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
    let loading = false;
    let loadedOnce = false;
    const refresh = async () => {
      // Die regelmäßige Auffrischung pausiert im verborgenen Tab — der ERSTE
      // Lauf nicht: Tableau lädt Extensions auch in einem Dashboard-Reiter, der
      // beim Öffnen noch nicht sichtbar ist. Ohne diese Ausnahme blieben
      // Playbook, Slash-Befehle und die Dashboard-Registrierung dauerhaft aus,
      // bis der Nutzer den Tab einmal wechselt.
      if (loading || (loadedOnce && document.visibilityState === 'hidden')) return;
      loading = true;
      loadedOnce = true;
      try {
        if (playbookKey) {
          const registered = await registerDashboard(baseUrl, apiToken || undefined, playbookKey, dashboard);
          if (!cancelled) setRegistrationMessage(registered
           ? t('app.registration.available')
           : t('app.registration.unavailable'));
        }
        if (cancelled) return;
        const loaded = await loadSlashCommands(baseUrl, apiToken || undefined, playbookKey || undefined);
        if (cancelled) return;
        setCommands(loaded.commands);
        setPlaybookStarters(loaded.starters);
      } finally { loading = false; }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 60_000);
    const onVisible = () => { void refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [baseUrl, apiToken, playbookKey, dashboard, authReady]);

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
    void loadPrefs(baseUrl, apiToken || undefined, userId, dashboardKey)
      .then((result) => {
        if (!cancelled) setPrefs(result);
      })
      .catch(() => {
        // Lade-Fehlschlag getrennt von "nichts gespeichert" halten (siehe
        // prefs-client.ts) — sonst wirkt ein Ladefehler wie ein Verlust
        // gespeicherter Fragen (UI-Review P1-4).
        if (!cancelled) setPrefs('error');
      });
    return () => {
      cancelled = true;
    };
  }, [baseUrl, apiToken, userId, dashboardKey, authReady, features.savedQueries, prefsReloadToken]);

  /** "Erneut laden" nach einem Präferenzen-Ladefehler — siehe SettingsPanel/SavedQueriesPanel. */
  const reloadPrefs = useCallback(() => setPrefsReloadToken((v) => v + 1), []);

  /** Schreibt Präferenzen optimistisch, macht bei Fehler den State-Update rückgängig. */
  const updatePrefs = useCallback(
    async (next: DashboardPrefs): Promise<string | null> => {
      if (!userId) return t('app.prefs.noUserId');
      const previous = prefs;
      setPrefs(next);
      try {
        await savePrefs(baseUrl, apiToken || undefined, userId, dashboardKey, next);
        return null;
      } catch (err) {
        setPrefs(previous);
        return err instanceof Error ? err.message : t('app.prefs.saveError');
      }
    },
    [userId, prefs, baseUrl, apiToken, dashboardKey],
  );

  const getContext = useCallback(async () => {
    if (snapshotRef.current.value === null || snapshotRef.current.dirty) {
      snapshotRef.current.value = await buildContextSnapshot(dashboard);
      snapshotRef.current.dirty = false;
      setContextDirty(false);
      setContextChange(null);
    }
    return snapshotRef.current.value;
  }, [dashboard]);

  const authorContext = settings.dashboardContext.trim() || undefined;
  // Nur ein tatsächlich gewählter Fokus (nicht 'loading'/'unavailable'/leer)
  // fließt in den System-Prompt.
  const answerFocus = typeof prefs === 'object' && prefs !== null && prefs.focus ? prefs.focus : undefined;

  const runTurn = useCallback(
    (userText: string | null) => {
      if (!authReady) return;
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
            mode,
            getContext,
            executeTool: (call, approval, signal) => ['tableau_server_search', 'tableau_metadata_search', 'tableau_metadata_field', 'tableau_view_data', 'propose_watch_rule'].includes(call.function.name)
              ? executeTableauTool({ call, signal, baseUrl, apiToken: apiToken || undefined, dashboardKey: dashboardKey || undefined, consent: consentGateRef.current })
              : call.function.name.startsWith('mcp__')
                ? executeMcpTool({ call, approval, signal, dashboardKey: dashboardKey || '', baseUrl, apiToken: apiToken || undefined, confirm: (message) => window.confirm(message) })
                : executeToolCall(call, dashboard, { baseUrl, apiToken: apiToken || undefined }),
          },
          {
            onRoundStart: () => dispatch({ type: 'round-start' }),
            onAssistantDelta: (text) => dispatch({ type: 'delta', text }),
            onAssistantFinal: (text) => dispatch({ type: 'finalize', text }),
            onSuggestions: (suggestions) => dispatch({
              type: 'suggestions',
              // Dashboard-Aktionen sind Enterprise ("actions"): ohne Lizenz
              // wird eine dennoch aufgetauchte Liste hart verworfen, statt nur
              // den Button auszublenden — siehe runDashboardAction unten.
              suggestions: features.actions ? suggestions : { ...suggestions, actions: [] },
            }),
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
              if (/HTTP 403/.test(text)) setAccessReload(value => value + 1);
              dispatch({ type: 'error', text, retryable });
            },
            onDone: (data) => {
              dispatch({ type: 'done' });
              if (data.finishReason === 'length') {
                dispatch({ type: 'notice', text: t('app.chat.lengthLimit') });
              }
            },
          },
        )
        .finally(() => setBusy(false));
    },
    [session, baseUrl, apiToken, settings.model, userId, authorContext, answerFocus, mode, getContext, dashboard, logout, features.actions, authReady],
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
    dispatch({ type: 'notice', text: t('app.chat.cancelled') });
  }, [session]);

  // Vom LLM VORGESCHLAGENE Aktion — Ausführung ausschließlich hier,
  // nach explizitem User-Klick (Human-in-the-Loop, siehe tableau/actions.ts).
  const runDashboardAction = useCallback(
    (action: DashboardAction) => {
      if (busy) return;
      // Zweite Sperre neben dem Filtern in onSuggestions: Dashboard-Aktionen
      // sind Enterprise ("actions") — ohne Lizenz nie ausführen, selbst wenn
      // irgendwo doch ein Action-Chip gerendert würde.
      if (!features.actions) {
        dispatch({ type: 'notice', text: t('app.chat.actionsUnlicensed') });
        return;
      }
      // Die gleich folgende Markierung stammt von uns, nicht vom Nutzer.
      if (action.type === 'select_marks') ownSelectionRef.current = true;
      void executeDashboardAction(action, dashboard)
        .then((message) => {
          dispatch({ type: 'notice', text: message });
          sendUsageEvents(baseUrl, apiToken || undefined, [{ metric: 'action_executed', key: action.type }]);
        })
        .catch((err: unknown) =>
          dispatch({
            type: 'notice',
            text: t('app.chat.actionFailed', undefined, { error: err instanceof Error ? err.message : String(err) }),
          }),
        );
    },
    [busy, dashboard, baseUrl, apiToken, features.actions],
  );

  // OpenViz Watch (W6): „AI proposes, human approves" — legt die Regel erst
  // nach explizitem Klick auf die Bestätigungskarte an (WatchProposalCard).
  // Erfolg entfernt die Karte (dispatch) und zeigt eine Notice; ein Fehler
  // bleibt in der Karte selbst sichtbar (siehe deren Rückgabewert).
  const onCreateWatchRule = useCallback(
    async (proposal: WatchRuleProposal, itemId: number) => {
      const result = await createWatchRule(baseUrl, apiToken || undefined, proposal, consentGateRef.current);
      if (!result.ok) return { ok: false, message: result.message };
      dispatch({ type: 'watch-proposal-handled', id: itemId });
      dispatch({ type: 'notice', text: t('watch.proposal.created') });
      return { ok: true };
    },
    [baseUrl, apiToken],
  );

  const onDiscardWatchProposal = useCallback((itemId: number) => {
    dispatch({ type: 'watch-proposal-handled', id: itemId });
  }, []);

  // Vorschlagsfragen für den leeren Zustand — client-seitig, ohne LLM-Call.
  // Reihenfolge: vom User gespeicherte Standardfragen (★-Präfix), dann die
  // Starter aus dem Admin-Playbook dieses Dashboards, dann generische
  // Vorschläge — insgesamt max. 6 Chips, ohne Dubletten.
  const starters = useMemo(() => {
    const names = dashboard.worksheets.map((w) => w.name);
    const generic = [
      t('app.starters.summary'),
      t('app.starters.anomalies'),
      t('app.starters.filters'),
      ...names.slice(0, 2).map((n) => t('app.starters.worksheet', undefined, { name: n })),
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
    ].slice(0, 10);
  }, [dashboard, prefs, playbookStarters]);

  // Speichert eine gestellte Frage als Standardfrage für dieses Dashboard
  // (☆-Button an jeder User-Message, siehe MessageList). undefined ohne
  // User-ID oder ohne Enterprise-Lizenz für "savedQueries" — dann erscheint der
  // Button gar nicht erst, statt beim Speichern an einer 402 zu scheitern.
  const onSaveStandard = useMemo(() => {
    // Auch ohne Ladefehler kein Speichern anbieten, solange die eigentlichen
    // Präferenzen nicht bekannt sind — sonst überschreibt eine einzelne neue
    // Standardfrage einen Datensatz, den wir nie erfolgreich gelesen haben
    // (UI-Review P1-4).
    if (!userId || !features.savedQueries || prefs === 'error') return undefined;
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
    items.length === 0 &&
    prefs !== 'loading' &&
    prefs !== 'unavailable' &&
    prefs !== 'error' &&
    (prefs === null || prefs.focus === '');

  const onPickFocus = useCallback(
    (focus: string) => {
      const questions = typeof prefs === 'object' && prefs !== null ? prefs.questions : [];
      void updatePrefs({ focus, questions }).then((err) =>
        dispatch({ type: 'notice', text: err ?? t('app.focus.saved') }),
      );
    },
    [prefs, updatePrefs],
  );

  const onSkipFocus = useCallback(() => {
    const questions = typeof prefs === 'object' && prefs !== null ? prefs.questions : [];
    void updatePrefs({ focus: '', questions }).then((err) =>
      dispatch({ type: 'notice', text: err ?? t('app.focus.started') }),
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
        text: ok ? t('app.transcript.copied') : t('app.transcript.copyFailed'),
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
    // Erst nach dem Speicherversuch übernehmen (Workbook-Erfolg oder bewusster
    // Sitzungsmodus-Fallback) statt optimistisch davor — siehe saveSettings().
    const result = await saveSettings(next);
    setSettings(next);
    return result.message ?? null;
  }, []);

  // Tableau-Menüpunkt „Konfigurieren" (initializeAsync-configure-Callback in
  // main.tsx) öffnet denselben SettingsPanel wie das Zahnrad im Header.
  useEffect(() => {
    setConfigureHandler(() => setSettingsOpen(true));
    return () => setConfigureHandler(null);
  }, []);

  return (
    <div class="app">
      <header class="header">
        <span class="title" title={dashboard.name}>
          OpenVizPilot
        </span>
        {contextDirty && (
          <span class="context-hint" title={t('app.context.updated')}>
            {contextChange ?? t('app.context.changed')}
          </span>
        )}
        {items.length > 0 && (
          <button
            type="button"
            class="btn-icon"
            title={t('app.header.copyTranscriptTitle')}
            aria-label={t('app.header.copyTranscriptTitle')}
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
            title={`${t('app.header.logoutTitle')}${authSession.user.name || authSession.user.email ? ` (${authSession.user.name ?? authSession.user.email})` : ''}`}
            aria-label={t('app.header.logoutTitle')}
            onClick={logout}
          >
            ⎋
          </button>
        )}
        <button
          type="button"
          class="btn-icon"
          title={t('app.header.settingsTitle')}
          aria-label={t('app.header.settingsTitle')}
          // Nur öffnen: ein blindes Umschalten würde die Verwerfen-/
          // Weiterbearbeiten-Entscheidung im Panel umgehen (UI-Review P1-3) —
          // Schließen läuft ausschließlich über "Zurück zum Chat" dort.
          onClick={() => setSettingsOpen(true)}
        >
          ⚙
        </button>
      </header>
      {settingsOpen ? (
        <SettingsPanel
          settings={settings}
          registrationMessage={registrationMessage}
          registrationKey={playbookKey}
          onResetRegistration={async () => {
            if (!window.confirm(t('app.confirm.resetRegistration'))) return;
            const key = await ensureDashboardKey(true);
            if (key) { setPlaybookKey(key); setPlaybookStarters([]); }
            else setRegistrationMessage(t('app.confirm.resetRegistrationDisabled'));
          }}
          models={models}
          defaultModel={defaultModel}
          backendUrl={baseUrl}
          apiToken={apiToken}
          userId={userId}
          isAuthor={isAuthor}
          prefs={prefs}
          features={features}
          onSave={onSaveSettings}
          onSavePrefs={updatePrefs}
          onReloadPrefs={reloadPrefs}
          onClose={() => setSettingsOpen(false)}
        />
      ) : needsLogin && authConfig ? (
        // Einstellungen bleiben auch vor der Anmeldung erreichbar (z. B. falsche Backend-URL).
        <LoginGate baseUrl={baseUrl} config={loginError ? { ...authConfig, error: loginError } : authConfig} onLoggedIn={onLoggedIn} />
      ) : !authReady ? (
        <section class="login-panel" aria-live="polite">
          <h2>{access ? t('app.access.pendingTitle') : t('app.access.statusTitle')}</h2>
          {access ? (
            <>
              <p>{t('app.access.aiChatLabel')}: {access.ai ? t('app.access.granted') : t('app.access.notGranted')}</p>
              <p>{t('app.access.tableauApiLabel')}: {access.tableauApi ? t('app.access.granted') : t('app.access.notGranted')}</p>
              <p class="memory-hint">{authSession ? t('app.access.adminHint') : t('app.access.loginHint')}</p>
            </>
          ) : <p>{accessState?.key === accessKey && accessState.error ? accessState.error : t('app.access.checking')}</p>}
          <button type="button" onClick={() => setAccessReload(value => value + 1)}>{t('app.access.refreshButton')}</button>
        </section>
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
            watch={
              features.watch
                ? { signedInEmail: authSession?.user.email, onCreate: onCreateWatchRule, onDiscard: onDiscardWatchProposal }
                : undefined
            }
          />
          {selectionIn && !busy && (
            // Der Anwender hat im Dashboard etwas markiert. Statt still
            // abzuwarten, bietet die Extension an, genau das auszuwerten —
            // ausgeführt wird es erst auf Klick.
            <div class="selection-hint">
              <button
                type="button"
                class="chip"
                onClick={() => {
                  const worksheet = selectionIn;
                  setSelectionIn(null);
                  send(t('app.selection.evaluate', undefined, { worksheet }));
                }}
              >
                {t('app.selection.evaluate', undefined, { worksheet: selectionIn })}
              </button>
              <button type="button" class="btn-icon" title={t('app.selection.hideTitle')} aria-label={t('app.selection.hideTitle')} onClick={() => setSelectionIn(null)}>
                ×
              </button>
            </div>
          )}
          <Composer
            busy={busy}
            disabled={false}
            commands={commands}
            mode={mode}
            onModeChange={setMode}
            serverDataAvailable={features.serverData}
            onSend={send}
            onStop={stop}
          />
        </>
      )}
      <ServerDataConsentDialog
        open={consentPrompt !== null}
        message={consentPrompt?.message ?? ''}
        onAccept={() => {
          const resolve = consentPrompt?.resolve;
          setConsentPrompt(null);
          resolve?.(true);
        }}
        onDecline={() => {
          const resolve = consentPrompt?.resolve;
          setConsentPrompt(null);
          resolve?.(false);
        }}
      />
    </div>
  );
}
