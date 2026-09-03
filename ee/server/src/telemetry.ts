import { hasFeature, type LicenseStatus } from './license';

/**
 * Lizenz-Heartbeat (Enterprise): Eine lizenzierte Installation meldet dem
 * Hersteller in großen Abständen, dass und womit sie läuft — Grundlage für
 * Verlängerung, Support und die Frage, ob eine Lizenz über ihren Umfang hinaus
 * genutzt wird.
 *
 * Was gesendet wird, ist bewusst klein und vollständig aufzählbar:
 * - der signierte Lizenzschlüssel selbst (der Empfänger prüft die Signatur und
 *   liest Lizenznehmer, Tier, Features und Laufzeit daraus — der Client kann
 *   also nichts behaupten, was nicht in der Lizenz steht),
 * - eine zufällige, dauerhafte Installations-ID (unterscheidet mehrere
 *   Installationen desselben Kunden),
 * - die Produktversion,
 * - zwei Zahlen: aktive Anwender der letzten 30 Tage und Anzahl genutzter
 *   Dashboards.
 *
 * Was NIE gesendet wird: Namen, Nutzer-IDs oder Pseudonyme, Dashboard-Namen,
 * Fragen, Antworten, Dashboard-Daten, Konfiguration, Hostnamen oder IPs (die
 * Gegenstelle speichert auch keine).
 *
 * Ohne gültige Lizenz läuft nichts davon: Die Open-Core-Edition sendet nie,
 * und ein Ausfall der Gegenstelle darf die Installation nie beeinträchtigen —
 * jeder Fehler bleibt eine Logzeile.
 */

export const HEARTBEAT_SCHEMA = 'openvizpilot-heartbeat-v1';
/**
 * Feste Gegenstelle. Bewusst nicht konfigurierbar: Der Heartbeat ist Teil der
 * Enterprise-Lizenz, nicht eine Einstellung des Betriebs.
 */
export const HEARTBEAT_ENDPOINT = 'https://werkworks.de/ovp-lizenz/heartbeat.php';
/** Einmal am Tag genügt — es geht um Bestand, nicht um Verlauf. */
export const HEARTBEAT_INTERVAL_MS = 24 * 60 * 60 * 1000;
/** Nach dem Start kurz warten, damit ein Rollout nicht alle Replicas gleichzeitig sendet. */
export const HEARTBEAT_START_DELAY_MS = 60_000;
const REQUEST_TIMEOUT_MS = 10_000;
/** Aktive Anwender werden über diesen Zeitraum gezählt. */
export const USAGE_WINDOW_DAYS = 30;

export interface HeartbeatUsage {
  /** Anzahl unterschiedlicher Anwender-Pseudonyme der letzten 30 Tage (nur die Zahl). */
  activeUsers30d: number;
  /** Anzahl Dashboards, in denen gefragt wurde (nur die Zahl, nie die Namen). */
  dashboards: number;
}

export interface HeartbeatPayload {
  schema: typeof HEARTBEAT_SCHEMA;
  installationId: string;
  /** Signierter Lizenzschlüssel — die Gegenstelle verifiziert ihn selbst. */
  license: string;
  version: string;
  sentAt: string;
  usage: HeartbeatUsage;
}

/** Zustand des Heartbeats — eigene Tabelle in ee/, siehe telemetry-store.ts. */
export interface TelemetryStore {
  /** Zufällige, dauerhafte ID dieser Installation; wird beim ersten Aufruf race-sicher angelegt. */
  getInstallationId(): Promise<string>;
  /**
   * Beansprucht das Senden für dieses Intervall. Nur EINE Replica bekommt
   * `true` — ohne das würde jede Replica täglich denselben Heartbeat schicken.
   */
  claimHeartbeat(nowMs: number, intervalMs: number): Promise<boolean>;
  recordHeartbeatResult(nowMs: number, ok: boolean, detail: string): Promise<void>;
  getHeartbeatState(): Promise<{ lastAttemptAt: number | null; lastOkAt: number | null; lastDetail: string | null }>;
}

export interface TelemetryLogger {
  debug(msg: string, data?: Record<string, unknown>): void;
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
}

export interface HeartbeatDeps {
  /** Leer = abgeschaltet (nur für Entwicklung und Tests). */
  endpoint: string;
  /** Aktueller Lizenzstatus samt Rohtoken — beides kommt aus dem Auth-Zustand. */
  license: () => Promise<{ status: LicenseStatus; token: string | null }>;
  version: string;
  store: TelemetryStore;
  usage: () => Promise<HeartbeatUsage>;
  logger: TelemetryLogger;
  fetchImpl?: typeof fetch;
}

export function buildHeartbeatPayload(input: {
  installationId: string;
  license: string;
  version: string;
  usage: HeartbeatUsage;
  now?: Date;
}): HeartbeatPayload {
  return {
    schema: HEARTBEAT_SCHEMA,
    installationId: input.installationId,
    license: input.license,
    version: input.version,
    sentAt: (input.now ?? new Date()).toISOString(),
    usage: {
      activeUsers30d: Math.max(0, Math.trunc(input.usage.activeUsers30d)),
      dashboards: Math.max(0, Math.trunc(input.usage.dashboards)),
    },
  };
}

/**
 * Sendet einen Heartbeat, wenn die Lizenz gültig ist und diese Replica das
 * Intervall beanspruchen konnte. Wirft nie.
 */
export async function sendHeartbeatOnce(deps: HeartbeatDeps, now: number = Date.now()): Promise<'sent' | 'skipped' | 'failed'> {
  if (!deps.endpoint) return 'skipped';
  const { status, token } = await deps.license();
  // Nur lizenzierte Installationen senden — Open Core meldet sich nie.
  if (status.status !== 'valid' || !token) return 'skipped';

  // Der Sendeslot liegt in der Datenbank. Ist sie gerade weg, fällt der
  // Heartbeat aus — laut, aber folgenlos: eine Logzeile, kein Fehler nach oben.
  try {
    if (!(await deps.store.claimHeartbeat(now, HEARTBEAT_INTERVAL_MS))) return 'skipped';
  } catch (err) {
    const detail = err instanceof Error ? err.name : 'unknown';
    // Der Versuch, das Scheitern festzuhalten, geht über dieselbe Datenbank und
    // schlägt darum meist mit fehl — aber wenn sie wieder da ist, soll die
    // Admin-UI nicht weiter den letzten guten Stand zeigen.
    await deps.store.recordHeartbeatResult(now, false, detail).catch(() => undefined);
    deps.logger.warn('license heartbeat could not claim the interval', { name: detail });
    return 'failed';
  }

  let payload: HeartbeatPayload;
  try {
    payload = buildHeartbeatPayload({
      installationId: await deps.store.getInstallationId(),
      license: token,
      version: deps.version,
      usage: await deps.usage(),
      now: new Date(now),
    });
  } catch (err) {
    const detail = err instanceof Error ? err.name : 'unknown';
    await deps.store.recordHeartbeatResult(now, false, detail).catch(() => undefined);
    deps.logger.warn('license heartbeat could not be built', { name: detail });
    return 'failed';
  }

  try {
    const res = await (deps.fetchImpl ?? fetch)(deps.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const ok = res.ok;
    await deps.store.recordHeartbeatResult(now, ok, ok ? 'ok' : `HTTP ${res.status}`).catch(() => undefined);
    if (ok) {
      deps.logger.debug('license heartbeat sent');
      return 'sent';
    }
    deps.logger.warn('license heartbeat rejected', { status: res.status });
    return 'failed';
  } catch (err) {
    // Die Gegenstelle ist nicht erreichbar — für die Installation folgenlos.
    const detail = err instanceof Error ? err.name : 'unknown';
    await deps.store.recordHeartbeatResult(now, false, detail).catch(() => undefined);
    deps.logger.warn('license heartbeat failed', { name: detail });
    return 'failed';
  }
}

/**
 * Startet den periodischen Heartbeat und liefert die Stopp-Funktion. Der Timer
 * hält den Prozess nicht am Leben (`unref`), damit ein Shutdown nicht wartet.
 */
export function startHeartbeat(deps: HeartbeatDeps): () => void {
  if (!deps.endpoint) {
    deps.logger.info('Lizenz-Heartbeat deaktiviert (kein Endpunkt konfiguriert)');
    return () => undefined;
  }

  const tick = () => void sendHeartbeatOnce(deps).catch(() => undefined);
  const first = setTimeout(tick, HEARTBEAT_START_DELAY_MS);
  const repeat = setInterval(tick, HEARTBEAT_INTERVAL_MS);
  first.unref?.();
  repeat.unref?.();

  return () => {
    clearTimeout(first);
    clearInterval(repeat);
  };
}

/** Für die Admin-UI: was gesendet wird und wie es zuletzt lief. */
export async function describeTelemetry(deps: {
  endpoint: string;
  license: () => Promise<{ status: LicenseStatus; token: string | null }>;
  store: TelemetryStore | null;
}): Promise<{
  active: boolean;
  reason: string;
  endpoint: string | null;
  intervalHours: number;
  sends: string[];
  neverSends: string[];
  lastAttemptAt: string | null;
  lastOkAt: string | null;
  lastDetail: string | null;
}> {
  const { status } = await deps.license();
  const licensed = status.status === 'valid';
  const state = deps.store ? await deps.store.getHeartbeatState().catch(() => null) : null;
  return {
    active: licensed && Boolean(deps.endpoint) && deps.store !== null,
    reason: !deps.endpoint
      ? 'Kein Endpunkt konfiguriert.'
      : !deps.store
        ? 'Keine Datenbank konfiguriert.'
        : licensed
          ? 'Teil der Enterprise-Lizenz.'
          : 'Open-Core-Edition sendet nicht.',
    endpoint: deps.endpoint || null,
    intervalHours: HEARTBEAT_INTERVAL_MS / 3_600_000,
    sends: [
      'der signierte Lizenzschlüssel (Lizenznehmer, Tier, Features, Laufzeit)',
      'eine zufällige Installations-ID',
      'die Produktversion',
      `Anzahl aktiver Anwender der letzten ${USAGE_WINDOW_DAYS} Tage`,
      'Anzahl genutzter Dashboards',
    ],
    neverSends: [
      'Namen, Nutzer-IDs oder Pseudonyme',
      'Dashboard-Namen',
      'Fragen, Antworten oder Dashboard-Daten',
      'Konfiguration, Hostnamen oder IP-Adressen',
    ],
    lastAttemptAt: state?.lastAttemptAt ? new Date(state.lastAttemptAt).toISOString() : null,
    lastOkAt: state?.lastOkAt ? new Date(state.lastOkAt).toISOString() : null,
    lastDetail: state?.lastDetail ?? null,
  };
}

/** Praktisch für Aufrufer: gilt eine bestimmte Funktion als lizenziert? */
export function licensedFor(status: LicenseStatus, feature: Parameters<typeof hasFeature>[1]): boolean {
  return hasFeature(status, feature);
}
