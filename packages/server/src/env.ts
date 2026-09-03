import fs from 'node:fs';
import { HEARTBEAT_ENDPOINT } from '@openvizpilot/ee/server';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const envSchema = z.object({
  LITELLM_BASE_URL: z.string().url({ message: 'LITELLM_BASE_URL muss eine gültige URL sein' }),
  LITELLM_API_KEY: z.string().min(1, 'LITELLM_API_KEY fehlt'),
  DEFAULT_MODEL: z.string().min(1, 'DEFAULT_MODEL fehlt'),
  MODEL_ALLOWLIST: z.string().optional(),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  ALLOWED_ORIGINS: z.string().optional(),
  SERVE_STATIC_DIR: z.string().optional(),
  API_AUTH_TOKEN: z.string().optional(),
  ADMIN_TOKEN: z.string().optional(),
  MEMORY_DATABASE_URL: z.string().optional(),
  MEMORY_DB_PATH: z.string().optional(),
  MEMORY_MODEL: z.string().optional(),
  SCOPE_GUARD: z.enum(['on', 'off']).default('on'),
  SCOPE_MODEL: z.string().optional(),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  // --- Enterprise (ee/): Anmeldung & Lizenz ---
  AUTH_MODE: z.enum(['none', 'token', 'local', 'oidc']).optional(),
  PUBLIC_URL: z.string().url().optional().or(z.literal('')),
  OIDC_PROVIDER: z.enum(['entra', 'keycloak', 'generic']).default('generic'),
  OIDC_ISSUER: z.string().url().optional().or(z.literal('')),
  OIDC_CLIENT_ID: z.string().optional(),
  OIDC_CLIENT_SECRET: z.string().optional(),
  OIDC_SCOPES: z.string().default('openid profile email'),
  OVP_LICENSE: z.string().optional(),
  /** Produktversion für den Heartbeat (Helm setzt sie aus der Chart-AppVersion). */
  APP_VERSION: z.string().optional(),
  OVP_LICENSE_PATH: z.string().optional(),
  OVP_LICENSE_PUBLIC_KEY_B64URL: z.string().optional(),
  OVP_LICENSE_PUBLIC_KEY_PATH: z.string().optional(),
});

export interface AppConfig {
  litellmBaseUrl: string;
  litellmApiKey: string;
  defaultModel: string;
  /** null = keine Einschränkung (alles, was der Proxy meldet) */
  modelAllowlist: string[] | null;
  port: number;
  allowedOrigins: string[];
  serveStaticDir: string | null;
  /** null = /api/* ist offen (dann Zugriff über Netzwerk/Reverse Proxy beschränken!) */
  apiAuthToken: string | null;
  /**
   * Bearer-Token für /api/admin/* und die Admin-UI unter /admin — eigenes,
   * von apiAuthToken unabhängiges Regime. null = Admin-UI komplett deaktiviert
   * (404), siehe app.ts und routes/admin.ts.
   */
  adminToken: string | null;
  /** Postgres-URI für das User-Memory (Prod/EKS, z. B. aus CloudNativePG-Secret). */
  memoryDatabaseUrl: string | null;
  /** SQLite-Fallback für lokale Entwicklung; ignoriert, wenn memoryDatabaseUrl gesetzt. */
  memoryDbPath: string | null;
  /** Modell für die Fakten-Extraktion (Default: defaultModel; günstiges Modell empfohlen). */
  memoryModel: string;
  /**
   * Serverseitiger Themen-Filter vor dem Haupt-LLM-Call: Off-Topic-Fragen
   * werden abgelehnt, ohne das Hauptmodell aufzurufen (llm/scope-guard.ts).
   * Default an; SCOPE_GUARD=off schaltet ihn ab.
   */
  scopeGuardEnabled: boolean;
  /** Modell für den Scope-Guard (Default: memoryModel; günstiges Modell empfohlen). */
  scopeModel: string;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  /**
   * Zugriffsschutz für /api/*: 'none' (nur Netzwerk), 'token' (API_AUTH_TOKEN,
   * Default sobald eines gesetzt ist) oder 'oidc' (Enterprise: Login der
   * Anwender per Single Sign-On, verifizierte Nutzer-ID — braucht eine
   * gültige Lizenz mit Feature "sso", siehe ee/).
   */
  authMode: 'none' | 'token' | 'local' | 'oidc';
  /** Öffentlicher Origin der Middleware (für OIDC-Redirect-URI); null = aus dem Request. */
  publicUrl: string | null;
  oidc: {
    provider: 'entra' | 'keycloak' | 'generic';
    issuer: string;
    clientId: string;
    clientSecret: string | null;
    scopes: string;
  } | null;
  /** Rohwerte für die Lizenzprüfung (ee/server/src/license.ts). */
  /**
   * Gegenstelle des Lizenz-Heartbeats (ee/). Fest eingebrannt — es gibt bewusst
   * keinen Umgebungsschalter dafür, der Heartbeat gehört zur Enterprise-Lizenz.
   * Nur Tests setzen den Wert leer, damit nie ein echter Aufruf hinausgeht.
   */
  telemetryEndpoint: string;
  /** Produktversion, die im Heartbeat gemeldet wird. */
  appVersion: string;
  licenseEnv: {
    OVP_LICENSE?: string;
    OVP_LICENSE_PATH?: string;
    OVP_LICENSE_PUBLIC_KEY_B64URL?: string;
    OVP_LICENSE_PUBLIC_KEY_PATH?: string;
  };
}

function splitCsv(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Lädt .env (Repo-Root oder Paketverzeichnis), ohne echte Umgebungsvariablen zu überschreiben. */
export function loadDotEnv(): void {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(here, '../../../.env'), // Repo-Root, wenn via npm -w gestartet
  ];
  for (const file of candidates) {
    if (fs.existsSync(file)) {
      process.loadEnvFile(file);
      return;
    }
  }
}

export function loadEnv(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Ungültige Konfiguration (.env prüfen, Vorlage: .env.example):\n${details}`);
  }
  const e = parsed.data;
  const allowlist = splitCsv(e.MODEL_ALLOWLIST);
  const apiAuthToken = e.API_AUTH_TOKEN?.trim() ? e.API_AUTH_TOKEN.trim() : null;
  const authMode = e.AUTH_MODE ?? (apiAuthToken ? 'token' : 'none');
  if (authMode === 'token' && !apiAuthToken) {
    throw new Error('AUTH_MODE=token verlangt ein API_AUTH_TOKEN');
  }
  // OIDC-Daten dürfen auch später aus der Admin-UI kommen — ohne sie bleibt
  // der Modus fail-closed (auth-state.ts), kein Startabbruch nötig.
  return {
    litellmBaseUrl: e.LITELLM_BASE_URL.replace(/\/$/, ''),
    litellmApiKey: e.LITELLM_API_KEY,
    defaultModel: e.DEFAULT_MODEL,
    modelAllowlist: allowlist.length > 0 ? allowlist : null,
    port: e.PORT,
    allowedOrigins: splitCsv(e.ALLOWED_ORIGINS),
    serveStaticDir: e.SERVE_STATIC_DIR?.trim() ? e.SERVE_STATIC_DIR.trim() : null,
    apiAuthToken,
    adminToken: e.ADMIN_TOKEN?.trim() ? e.ADMIN_TOKEN.trim() : null,
    memoryDatabaseUrl: e.MEMORY_DATABASE_URL?.trim() ? e.MEMORY_DATABASE_URL.trim() : null,
    memoryDbPath: e.MEMORY_DB_PATH?.trim() ? e.MEMORY_DB_PATH.trim() : null,
    memoryModel: e.MEMORY_MODEL?.trim() ? e.MEMORY_MODEL.trim() : e.DEFAULT_MODEL,
    scopeGuardEnabled: e.SCOPE_GUARD === 'on',
    scopeModel:
      e.SCOPE_MODEL?.trim() ||
      (e.MEMORY_MODEL?.trim() ? e.MEMORY_MODEL.trim() : e.DEFAULT_MODEL),
    logLevel: e.LOG_LEVEL,
    authMode,
    publicUrl: e.PUBLIC_URL?.trim() ? e.PUBLIC_URL.trim().replace(/\/$/, '') : null,
    // OIDC-Defaults aus der Env, sobald Issuer UND Client-ID gesetzt sind —
    // unabhängig vom Modus (die Admin-UI kann später auf SSO umschalten).
    // Fehlen sie bei AUTH_MODE=oidc, bleibt die API fail-closed (auth-state.ts).
    oidc:
      e.OIDC_ISSUER?.trim() && e.OIDC_CLIENT_ID?.trim()
        ? {
            provider: e.OIDC_PROVIDER,
            issuer: e.OIDC_ISSUER.trim().replace(/\/$/, ''),
            clientId: e.OIDC_CLIENT_ID.trim(),
            clientSecret: e.OIDC_CLIENT_SECRET?.trim() ? e.OIDC_CLIENT_SECRET.trim() : null,
            scopes: e.OIDC_SCOPES.trim() || 'openid profile email',
          }
        : null,
    telemetryEndpoint: HEARTBEAT_ENDPOINT,
    appVersion: e.APP_VERSION?.trim() || 'unbekannt',
    licenseEnv: {
      OVP_LICENSE: e.OVP_LICENSE,
      OVP_LICENSE_PATH: e.OVP_LICENSE_PATH,
      OVP_LICENSE_PUBLIC_KEY_B64URL: e.OVP_LICENSE_PUBLIC_KEY_B64URL,
      OVP_LICENSE_PUBLIC_KEY_PATH: e.OVP_LICENSE_PUBLIC_KEY_PATH,
    },
  };
}
