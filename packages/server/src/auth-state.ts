import {
  hasFeature,
  OidcClient,
  readLicenseTokenFromEnv,
  verifyLicenseWithEnvKey,
  type LicenseStatus,
} from '@openvizpilot/ee/server';
import type { AuthMode, AuthSettings, OidcSettings } from '@openvizpilot/shared';
import type { AppConfig } from './env';
import type { Logger } from './logger';
import type { MemoryStore } from './memory/store';

/**
 * Effektiver Anmelde-Zustand der Middleware — zur Laufzeit aus zwei Quellen:
 *
 * 1. Env/Helm (AUTH_MODE, OIDC_*, OVP_LICENSE*) als Bootstrap-Defaults.
 * 2. Admin-UI (Tabelle admin_settings): Modus, OIDC-Client und Lizenz-Token —
 *    überschreiben die Env-Werte, damit ein Admin SSO und Lizenz ohne
 *    Redeploy pflegen kann.
 *
 * Der Vertrauensanker der Lizenz (Public Key) kommt NIE aus der DB: sonst
 * könnte ein Admin mit eigenem Schlüsselpaar sich selbst Lizenzen ausstellen.
 *
 * Fail-closed: Modus 'oidc' ohne gültige SSO-Lizenz (oder ohne OIDC-Daten)
 * öffnet die API nicht, sondern blockiert sie mit klarer Begründung — die
 * Extension zeigt die Meldung, die Admin-UI bleibt erreichbar (exempt).
 */

export interface AuthState {
  mode: AuthMode;
  /** Woher der Modus stammt: Admin-UI (DB) oder Env. */
  source: 'db' | 'env';
  oidc: OidcClient | null;
  oidcSettings: OidcSettings | null;
  license: LicenseStatus;
  /** Rohtoken zur `license` — der Lizenz-Heartbeat (ee/) sendet ihn unverändert. */
  licenseToken: string | null;
  /** Öffentlicher Origin für die SSO-Redirect-URI (Admin-UI oder PUBLIC_URL). */
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

export function createAuthStateProvider(config: AppConfig, store: MemoryStore | null, logger: Logger): AuthStateProvider {
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
          licenseToken: null,
          publicUrl: config.publicUrl,
          blockedReason: 'Anmelde-Einstellungen nicht lesbar (Datenbank nicht erreichbar) — Zugriff vorübergehend gesperrt.',
        };
      }
    }

    // Genau ein Lesevorgang: Status und Token gehören immer zusammen, auch
    // wenn die Lizenzdatei gerade rotiert wird.
    const fromEnv = settings?.license ? { token: settings.license, error: null } : readLicenseTokenFromEnv(config.licenseEnv);
    const licenseToken = fromEnv.token;
    const license: LicenseStatus = fromEnv.error
      ? { status: 'invalid', reason: fromEnv.error }
      : licenseToken
        ? verifyLicenseWithEnvKey(licenseToken, config.licenseEnv)
        : { status: 'none' };

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
            : 'Keine gültige Enterprise-Lizenz mit Feature „sso“ — Single Sign-On ist deaktiviert.';
      } else if (!oidcSettings) {
        blockedReason = 'Single Sign-On ist nicht konfiguriert (Issuer und Client-ID fehlen).';
      } else if (!publicUrl) {
        // Die Redirect-URI darf nie aus dem Host-Header des Requests entstehen.
        blockedReason = 'Single Sign-On braucht die öffentliche URL der Middleware (Admin-UI oder PUBLIC_URL).';
      } else {
        oidc = oidcClientFor(oidcSettings);
      }
    }
    return { mode, source: settings ? 'db' : 'env', oidc, oidcSettings, license, licenseToken, publicUrl, blockedReason };
  };

  return {
    async get(): Promise<AuthState> {
      const now = Date.now();
      if (cached && now - cached.at < CACHE_TTL_MS) return cached.state;
      inflight ??= compute()
        .then((state) => {
          cached = { state, at: Date.now() };
          return state;
        })
        .finally(() => {
          inflight = null;
        });
      return inflight;
    },
    invalidate(): void {
      cached = null;
    },
  };
}
