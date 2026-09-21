import {
  hasFeature,
  OidcClient,
  readLicenseTokenFromEnv,
  verifyLease,
  verifyLicense,
  type LeaseInfo,
  type LeaseRecord,
  type LicenseStatus,
  type TelemetryStore,
} from '@openvizpilot/ee/server';
import type { AuthMode, AuthSettings, OidcSettings } from '@openvizpilot/shared';
import type { AppConfig } from './env';
import type { Logger } from './logger';
import type { MemoryStore } from './memory/store';

/**
 * Effektiver Anmelde-Zustand der Middleware — zur Laufzeit aus zwei Quellen:
 *
 * 1. Env/Helm (OVP_AUTH_MODE, OIDC_*, OVP_LICENSE*) als Bootstrap-Defaults.
 * 2. Admin-UI (Tabelle admin_settings): Modus, OIDC-Client und Lizenz-Token —
 *    überschreiben die Env-Werte, damit ein Admin SSO und Lizenz ohne
 *    Redeploy pflegen kann.
 *
 * Der Vertrauensanker der Lizenz (Public Key) kommt NIE aus der DB: sonst
 * könnte ein Admin mit eigenem Schlüsselpaar sich selbst Lizenzen ausstellen.
 *
 * Aktivierung (L1): Zur Lizenz kommt die Lease des Online-Dienstes
 * (ee_telemetry_state). Enterprise-Features gibt es nur bei gültiger Lizenz
 * UND Lease `active` (online oder offline) oder `grace` (frühere Lease seit
 * weniger als 30 Tagen abgelaufen — Zusage: Nichterreichbarkeit schaltet
 * nichts ab). Eine Installation, die noch NIE eine Lease hatte (frisch oder
 * gerade aktualisiert), ist `pending` und läuft mit Core-Funktionen, bis der
 * erste Heartbeat (sofort beim Start) oder eine Offline-Lease sie aktiviert.
 * `blocked` (Aktivierungslimit ohne gültige Lease) und `expired` (Karenz
 * vorbei) sind ebenfalls Core — die Lizenz wird dann 'inactive'.
 */

export interface AuthState {
  mode: AuthMode;
  /** Woher der Modus stammt: Admin-UI (DB) oder Env. */
  source: 'db' | 'env';
  oidc: OidcClient | null;
  oidcSettings: OidcSettings | null;
  /** Effektive Lizenz (Signatur UND Lease-Zustand) — jede Feature-Prüfung läuft hierüber. */
  license: LicenseStatus;
  /**
   * Reine Signaturprüfung ohne Lease — der Heartbeat (ee/) sendet damit auch
   * bei blockierter Aktivierung weiter, sonst könnte er sich nie erholen.
   */
  verifiedLicense: LicenseStatus;
  /** Rohtoken zur `license` — der Lizenz-Heartbeat (ee/) sendet ihn unverändert. */
  licenseToken: string | null;
  /** Aktivierungszustand dieser Installation (Lease, Karenz) — für Admin-UI und Begründungen. */
  lease: LeaseInfo;
  /** Öffentlicher Origin für die SSO-Redirect-URI (Admin-UI oder OVP_PUBLIC_URL). */
  publicUrl: string | null;
  /**
   * Gesetzt, wenn die Anmeldung nicht betriebsbereit ist — die API bleibt dann
   * GESCHLOSSEN (503): SSO ohne Lizenz/Konfiguration/öffentliche URL, oder
   * Einstellungen wegen DB-Ausfall nicht lesbar (und noch kein Cache).
   */
  blockedReason: string | null;
}

export interface AuthStateProvider {
  get(): Promise<AuthState>;
  /** Nach dem Speichern in der Admin-UI aufrufen (sofortige Wirkung, alle Requests). */
  invalidate(): void;
}

/** Kurz genug, dass Änderungen aus der Admin-UI auf anderen Replicas zeitnah greifen. */
const CACHE_TTL_MS = 15_000;

/** Karenz: so lange bleibt alles an, wenn keine (gültige) Lease vorliegt — Zusage im Vertragstext (ee/telemetry/README.md). */
export const LEASE_GRACE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Lease-Zustand aus Lizenz und gespeichertem Lease-Datensatz — reine Funktion,
 * `now` injizierbar. Ohne Telemetrie-Store (keine Datenbank) gibt es keine
 * Installations-ID und damit keine Aktivierung: `pending`, Core-Funktionen.
 */
export function resolveLeaseState(input: {
  license: LicenseStatus;
  installationId: string | null;
  record: LeaseRecord | null;
  environment: LeaseInfo['environment'];
  leaseTrustedKeys?: Record<string, string>;
  now: Date;
}): LeaseInfo {
  const base = { environment: input.environment, installationId: input.installationId, leaseUntil: null, graceUntil: null, offline: false };
  if (!input.record || !input.installationId) {
    return { ...base, state: 'pending', serverState: 'none', message: 'Keine Datenbank — Aktivierung nicht möglich.' };
  }
  const { record } = input;
  const serverState = record.leaseState;
  const limitMessage = serverState === 'activation_limit' ? (record.leaseMessage ?? 'Aktivierungslimit der Lizenz erreicht') : null;
  // Eine Lease zählt nur, wenn sie zu DIESER Installation und Lizenz gehört.
  const lease =
    record.leaseToken && input.license.status !== 'none' && input.license.status !== 'invalid'
      ? verifyLease(record.leaseToken, {
          installationId: input.installationId,
          licenseId: input.license.license.licenseId,
          keys: input.leaseTrustedKeys,
          now: input.now,
        })
      : null;
  if (lease?.status === 'valid') {
    const leaseUntil = new Date(Date.parse(lease.lease.leaseUntil)).toISOString();
    return {
      ...base,
      state: 'active',
      offline: Boolean(lease.lease.offline),
      leaseUntil,
      graceUntil: new Date(Date.parse(leaseUntil) + LEASE_GRACE_MS).toISOString(),
      serverState,
      message: limitMessage,
    };
  }
  if (limitMessage) {
    // Limit gemeldet und keine gültige Lease — egal ob abgelaufen oder nie eine gehabt.
    return { ...base, state: 'blocked', leaseUntil: lease?.status === 'expired' ? lease.lease.leaseUntil : null, serverState, message: limitMessage };
  }
  if (lease?.status === 'expired') {
    const leaseUntilMs = Date.parse(lease.lease.leaseUntil);
    const graceUntilMs = leaseUntilMs + LEASE_GRACE_MS;
    const leaseUntil = new Date(leaseUntilMs).toISOString();
    const graceUntil = new Date(graceUntilMs).toISOString();
    if (input.now.getTime() < graceUntilMs) {
      return { ...base, state: 'grace', leaseUntil, graceUntil, serverState, message: 'Lease abgelaufen, WerkWorks nicht erreichbar — Enterprise-Funktionen bleiben bis zum Ende der Karenz aktiv.' };
    }
    return { ...base, state: 'expired', leaseUntil, graceUntil, serverState, message: 'Karenz abgelaufen — Lease seit über 30 Tagen nicht erneuert.' };
  }
  if (serverState === 'deactivated') {
    return { ...base, state: 'pending', serverState, message: 'Installation stillgelegt — erneute Aktivierung über „Jetzt aktualisieren“.' };
  }
  return { ...base, state: 'pending', serverState, message: 'Noch nicht aktiviert — Enterprise-Funktionen erst nach der ersten Aktivierung (Heartbeat an werkworks.de oder Offline-Lease).' };
}

export function createAuthStateProvider(
  config: AppConfig,
  store: MemoryStore | null,
  logger: Logger,
  telemetry: TelemetryStore | null = null,
  /** Nur für Tests: Zeitquelle der Lease-/Karenz-Berechnung. */
  now: () => Date = () => new Date(),
): AuthStateProvider {
  let cached: { state: AuthState; at: number } | null = null;
  let inflight: Promise<AuthState> | null = null;
  let oidcCache: { key: string; client: OidcClient } | null = null;

  const oidcClientFor = (settings: OidcSettings): OidcClient => {
    const key = JSON.stringify(settings);
    if (oidcCache?.key === key) return oidcCache.client;
    const client = new OidcClient({
      provider: settings.provider,
      issuer: settings.issuer,
      clientId: settings.clientId,
      clientSecret: settings.clientSecret,
      scopes: settings.scopes,
    });
    oidcCache = { key, client };
    return client;
  };

  const envOidc = (): OidcSettings | null =>
    config.oidc
      ? {
          provider: config.oidc.provider,
          issuer: config.oidc.issuer,
          clientId: config.oidc.clientId,
          clientSecret: config.oidc.clientSecret ?? undefined,
          scopes: config.oidc.scopes,
        }
      : null;

  const compute = async (): Promise<AuthState> => {
    let settings: AuthSettings | null = null;
    if (store) {
      try {
        settings = await store.getAuthSettings();
      } catch (err) {
        logger.error('auth settings unavailable', { name: err instanceof Error ? err.name : 'unknown' });
        // NICHT auf die Env-Defaults zurückfallen — die DB könnte einen
        // strengeren Modus enthalten. Letzten bekannten Zustand weiterverwenden,
        // sonst fail-closed.
        if (cached) return cached.state;
        return {
          mode: config.authMode,
          source: 'env',
          oidc: null,
          oidcSettings: null,
          license: { status: 'none' },
          verifiedLicense: { status: 'none' },
          licenseToken: null,
          lease: { state: 'pending', offline: false, leaseUntil: null, graceUntil: null, serverState: 'none', message: null, environment: config.environment, installationId: null },
          publicUrl: config.publicUrl,
          blockedReason: 'Anmelde-Einstellungen nicht lesbar (Datenbank nicht erreichbar) — Zugriff vorübergehend gesperrt.',
        };
      }
    }

    // Genau ein Lesevorgang: Status und Token gehören immer zusammen, auch
    // wenn die Lizenzdatei gerade rotiert wird.
    const fromEnv = settings?.license ? { token: settings.license, error: null } : readLicenseTokenFromEnv(config.licenseEnv);
    const licenseToken = fromEnv.token;
    const verifiedLicense: LicenseStatus = fromEnv.error
      ? { status: 'invalid', reason: fromEnv.error }
      : licenseToken
        ? verifyLicense(licenseToken, config.licenseTrustedKeys, now())
        : { status: 'none' };

    // Aktivierung: Lease-Datensatz lesen (Fehler = Karenz, nie ein Startabbruch).
    let record: LeaseRecord | null = null;
    let installationId: string | null = null;
    if (telemetry && verifiedLicense.status === 'valid') {
      try {
        [record, installationId] = await Promise.all([telemetry.getLease(), telemetry.getInstallationId()]);
      } catch (err) {
        logger.error('lease state unavailable', { name: err instanceof Error ? err.name : 'unknown' });
      }
    }
    const lease = resolveLeaseState({
      license: verifiedLicense,
      installationId,
      record,
      environment: config.environment,
      leaseTrustedKeys: config.leaseTrustedKeys,
      now: now(),
    });
    const license: LicenseStatus =
      verifiedLicense.status === 'valid' && lease.state !== 'active' && lease.state !== 'grace'
        ? {
            status: 'inactive',
            license: verifiedLicense.license,
            reason:
              lease.state === 'blocked'
                ? `Installation blockiert: ${lease.message ?? 'Aktivierungslimit der Lizenz erreicht'} — Installation übertragen oder alte stilllegen.`
                : lease.state === 'expired'
                  ? `Aktivierung abgelaufen — ${lease.message ?? 'Lease seit über 30 Tagen nicht erneuert.'}`
                  : `Installation noch nicht aktiviert — ${lease.message ?? 'erster Heartbeat oder Offline-Lease ausstehend.'}`,
          }
        : verifiedLicense;

    const mode: AuthMode = settings?.mode ?? config.authMode;
    const oidcSettings = settings?.oidc ?? envOidc();
    const publicUrl = settings?.publicUrl?.replace(/\/$/, '') ?? config.publicUrl;
    let blockedReason: string | null = null;
    let oidc: OidcClient | null = null;
    if (mode === 'oidc') {
      if (!hasFeature(license, 'sso')) {
        blockedReason =
          license.status === 'expired'
            ? 'Enterprise-Lizenz abgelaufen — Single Sign-On ist deaktiviert.'
            : license.status === 'inactive'
              ? `${license.reason} Single Sign-On ist deaktiviert.`
              : 'Keine gültige Enterprise-Lizenz mit Feature „sso“ — Single Sign-On ist deaktiviert.';
      } else if (!oidcSettings) {
        blockedReason = 'Single Sign-On ist nicht konfiguriert (Issuer und Client-ID fehlen).';
      } else if (!publicUrl) {
        // Die Redirect-URI darf nie aus dem Host-Header des Requests entstehen.
        blockedReason = 'Single Sign-On braucht die öffentliche URL der Middleware (Admin-UI oder OVP_PUBLIC_URL).';
      } else {
        oidc = oidcClientFor(oidcSettings);
      }
    }
    return { mode, source: settings ? 'db' : 'env', oidc, oidcSettings, license, verifiedLicense, licenseToken, lease, publicUrl, blockedReason };
  };

  // Generation: `invalidate()` verwirft auch eine laufende Berechnung — sonst
  // liefert der Aufruf direkt nach dem Speichern (Lizenz, Lease) den alten Stand
  // und hält ihn 15 s im Cache.
  let generation = 0;
  return {
    async get(): Promise<AuthState> {
      const nowMs = Date.now();
      if (cached && nowMs - cached.at < CACHE_TTL_MS) return cached.state;
      if (!inflight) {
        const gen = generation;
        inflight = compute()
          .then((state) => {
            if (gen === generation) cached = { state, at: Date.now() };
            return state;
          })
          .finally(() => {
            if (gen === generation) inflight = null;
          });
      }
      return inflight;
    },
    invalidate(): void {
      cached = null;
      inflight = null;
      generation += 1;
    },
  };
}
