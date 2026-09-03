import type { AuthSettings, DashboardPlaybook, ModelOption, SlashCommand } from '@openvizpilot/shared';
import type { AppConfig } from '../env';
import type { Logger } from '../logger';
import {
  createPgPersonalizationStore,
  createPgTelemetryStore,
  createSqlitePersonalizationStore,
  createSqliteTelemetryStore,
  type PersonalizationStore,
  type TelemetryStore,
} from '@openvizpilot/ee/server';
import { createPgMemoryStore, openPgPool } from './pg-store';
import { createSqliteMemoryStore, openSqliteDatabase } from './sqlite-store';

/**
 * Datenbank der Middleware: Admin-Konto, Anmeldung, Slash-Befehle, Playbooks,
 * Modell-Katalog und anonyme Nutzungsstatistik.
 *
 * Die Personalisierung (User-Memory, gespeicherte eigene Abfragen) liegt NICHT
 * hier, sondern als Enterprise-Funktion in ee/server/src/personalization-store.ts
 * — mit eigenen Tabellen auf derselben Verbindung.
 *
 * Backends:
 * - Postgres (MEMORY_DATABASE_URL) — Produktionspfad auf EKS, der Helm-Chart
 *   provisioniert dafür optional einen CloudNativePG-Cluster.
 * - SQLite via Node-Builtin node:sqlite (MEMORY_DB_PATH) — lokale Entwicklung
 *   ohne Infrastruktur.
 */

/** Zustand des (einzigen) Admin-Kontos im Passwort-Modus — siehe admin-auth.ts. */
export interface AdminAccount {
  passwordHash: string;
  failedCount: number;
  /** Epoch-Millisekunden — null = nie fehlgeschlagen. */
  lastFailedAt: number | null;
  /** Epoch-Millisekunden — null = nicht gesperrt. */
  lockedUntil: number | null;
}

/** Lokales Benutzerkonto (Open-Core-Anmeldung), inkl. Lockout-Zustand. */
export interface LocalUser {
  username: string;
  displayName: string;
  createdAt: string;
  disabled: boolean;
}

export interface LocalUserAuth extends LocalUser {
  passwordHash: string;
  failedCount: number;
  lastFailedAt: number | null;
  lockedUntil: number | null;
}

export interface MemoryStore {
  /**
   * Liest die zentral (Admin-UI) konfigurierten Slash-Befehle — null, wenn
   * nie konfiguriert (Aufrufer verwendet dann DEFAULT_SLASH_COMMANDS aus
   * @openvizpilot/shared) ODER wenn der gespeicherte Wert nicht mehr dem
   * aktuellen Schema entspricht (wie bei getPrefs: ungültig = "nichts da").
   */
  getSlashCommands(): Promise<SlashCommand[] | null>;
  /**
   * Ersetzt die Slash-Befehle komplett (Singleton-Zeile). `null` setzt auf
   * die eingebauten Defaults zurück (löscht die gespeicherte Zeile) — dafür
   * nutzt die Admin-Route DELETE /api/admin/commands.
   */
  setSlashCommands(commands: SlashCommand[] | null): Promise<void>;
  /**
   * Admin-verwalteter Modell-Katalog (Anzeigenamen für die Extension) — null,
   * wenn nie konfiguriert (dann gilt die Endpunkt-Liste ∩ MODEL_ALLOWLIST)
   * ODER wenn der gespeicherte Wert nicht mehr dem Schema entspricht.
   */
  getModelCatalog(): Promise<ModelOption[] | null>;
  /** Ersetzt den Modell-Katalog komplett (Singleton-Zeile); null setzt zurück. */
  setModelCatalog(catalog: ModelOption[] | null): Promise<void>;
  /** Playbook (Starter + Slash-Befehle) eines Dashboards — null, wenn keins/ungültig. */
  getPlaybook(dashboardKey: string): Promise<DashboardPlaybook | null>;
  /** Ersetzt das Playbook eines Dashboards; null löscht es. */
  setPlaybook(dashboardKey: string, playbook: DashboardPlaybook | null): Promise<void>;
  /** Alle gespeicherten Playbooks (Admin-UI), ungültige übersprungen. */
  listPlaybooks(): Promise<Array<{ dashboardKey: string; playbook: DashboardPlaybook }>>;
  /**
   * Aggregiert ANONYME Nutzungs-Events zu einem Tages-Zähler (Tag · Metrik ·
   * Key → count+1). NIE Frage-/Antwort-Inhalte oder User-IDs entgegennehmen
   * — das erzwingt bereits die Metrik-Whitelist in @openvizpilot/shared
   * (usage.ts) am öffentlichen /api/stats-Endpunkt.
   */
  recordUsage(events: Array<{ metric: string; key: string }>): Promise<void>;
  /** Aggregierte Zähler der letzten `days` Tage (inklusive heute), neueste zuerst. */
  getUsageStats(days: number): Promise<Array<{ day: string; metric: string; key: string; count: number }>>;
  /**
   * Geheimer Salt für Nutzungs-Pseudonyme (usage-pseudonym.ts) — wird beim
   * ersten Zugriff race-sicher erzeugt und ist danach für alle Replicas
   * identisch.
   */
  getUsageSalt(): Promise<string>;
  /**
   * Zählt eine Frage für (Tag · Dashboard · Pseudonym) hoch. userToken '' =
   * Anwender unbekannt (keine User-ID im Request) — zählt als Frage, aber
   * nicht als Anwender. NIE Namen, Roh-IDs oder Inhalte.
   */
  recordDashboardUsage(dashboardKey: string, userToken: string): Promise<void>;
  /** Fragen pro (Dashboard · Pseudonym) der letzten `days` Tage, über Tage summiert. */
  getDashboardUsage(days: number): Promise<Array<{ dashboardKey: string; userToken: string; questions: number }>>;
  /** Admin-Konto (Passwort-Modus) — null, wenn die Ersteinrichtung noch aussteht. */
  getAdminAccount(): Promise<AdminAccount | null>;
  /**
   * Legt das Admin-Konto EINMALIG an — false, wenn es schon existiert.
   * Race-sicher über einen bedingten Insert auf die Singleton-Zeile (id=1):
   * Bei zwei gleichzeitigen Ersteinrichtungen gewinnt genau eine.
   */
  createAdminAccount(passwordHash: string): Promise<boolean>;
  /**
   * Zählt einen Fehlversuch ATOMAR in der DB hoch (ein einzelnes UPDATE mit
   * Fenster-Logik + RETURNING) und liefert den neuen Zählerstand. Bewusst
   * KEIN Read-Modify-Write im Prozess: parallele Falsch-Logins würden sonst
   * alle denselben alten Stand lesen und der Lockout wäre per Request-Burst
   * umgehbar — auch über mehrere Replicas hinweg.
   */
  registerFailedAdminLogin(nowMs: number, windowMs: number): Promise<number>;
  /** Sperrt das Admin-Konto bis zum Zeitpunkt und setzt den Zähler zurück. */
  lockAdminAccount(untilMs: number): Promise<void>;
  /** Setzt Fehlversuchs-/Sperr-Zustand nach erfolgreichem Login zurück. */
  resetAdminLoginFailures(): Promise<void>;
  createAdminSession(tokenHash: string, expiresAtMs: number): Promise<void>;
  /** true, wenn die Session existiert und nicht abgelaufen ist; räumt Abgelaufenes lazy weg. */
  hasAdminSession(tokenHash: string, nowMs: number): Promise<boolean>;
  deleteAdminSession(tokenHash: string): Promise<void>;
  // --- Lokale Benutzer (Open-Core-Anmeldung in der Extension) ---
  listUsers(): Promise<LocalUser[]>;
  getUserAuth(username: string): Promise<LocalUserAuth | null>;
  /** false, wenn der Benutzername schon vergeben ist (race-sicherer Insert). */
  createUser(username: string, displayName: string, passwordHash: string): Promise<boolean>;
  setUserPassword(username: string, passwordHash: string): Promise<boolean>;
  setUserDisabled(username: string, disabled: boolean): Promise<boolean>;
  deleteUser(username: string): Promise<boolean>;
  /** Atomar wie registerFailedAdminLogin — liefert den neuen Zählerstand. */
  registerFailedUserLogin(username: string, nowMs: number, windowMs: number): Promise<number>;
  lockUser(username: string, untilMs: number): Promise<void>;
  resetUserLoginFailures(username: string): Promise<void>;
  createUserSession(tokenHash: string, username: string, expiresAtMs: number): Promise<void>;
  /** Benutzername der gültigen Session oder null; räumt Abgelaufenes lazy weg. */
  getUserSession(tokenHash: string, nowMs: number): Promise<string | null>;
  deleteUserSession(tokenHash: string): Promise<void>;
  deleteUserSessions(username: string): Promise<void>;
  // --- Admin-Einstellungen: Anmeldung/OIDC/Lizenz (überschreiben Env) ---
  getAuthSettings(): Promise<AuthSettings | null>;
  setAuthSettings(settings: AuthSettings | null): Promise<void>;
  /**
   * Schließt die Datenbankverbindung. ACHTUNG: Sie wird mit dem
   * Personalisierungs-Store der Enterprise-Edition geteilt — im laufenden
   * Betrieb `MemoryBackend.close()` verwenden, nicht diese Methode direkt.
   */
  close(): Promise<void>;
}

export interface MemoryBackend {
  /** Kern-Store: Admin, Anmeldung, Befehle, Playbooks, Modelle, Statistik. */
  store: MemoryStore;
  /** Enterprise-Personalisierung auf DERSELBEN Verbindung (ee/). */
  personalization: PersonalizationStore;
  /** Zustand des Lizenz-Heartbeats (ee/), ebenfalls auf derselben Verbindung. */
  telemetry: TelemetryStore;
  /**
   * Schließt die gemeinsame Verbindung — danach sind BEIDE Stores tot. Der
   * einzige richtige Weg, das Backend zu beenden; `store.close()` direkt
   * aufzurufen träfe denselben Handle, ließe aber offen, dass damit auch die
   * Personalisierung endet.
   */
  close(): Promise<void>;
}

/**
 * Öffnet die Datenbank EINMAL und baut beide Sichten darauf: den Kern-Store und
 * den Personalisierungs-Store aus ee/. Zwei Handles auf dieselbe Datei bzw. ein
 * zweiter Pool wären reine Verschwendung — und bei SQLite zusätzlich riskant.
 */
export function createMemoryStore(config: AppConfig, logger: Logger): MemoryBackend | null {
  if (config.memoryDatabaseUrl) {
    const pool = openPgPool(config.memoryDatabaseUrl);
    const store = createPgMemoryStore(pool, logger);
    return {
      store,
      personalization: createPgPersonalizationStore(pool, logger),
      telemetry: createPgTelemetryStore(pool, logger),
      close: () => store.close(),
    };
  }
  if (config.memoryDbPath) {
    const db = openSqliteDatabase(config.memoryDbPath);
    const store = createSqliteMemoryStore(db, logger);
    return {
      store,
      personalization: createSqlitePersonalizationStore(db),
      telemetry: createSqliteTelemetryStore(db),
      close: () => store.close(),
    };
  }
  return null;
}
