import fs from 'node:fs';
import { HEARTBEAT_ENDPOINT } from '@openvizpilot/ee/server';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

/** Behandelt einen leeren Umgebungswert wie „nicht gesetzt" (Vorlagen liefern leere Schlüssel). */
function emptyAsUnset<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess((value) => (value === '' ? undefined : value), schema);
}

/**
 * Alte (LiteLLM-Ära) Env-Namen → aktuelle OVP_*-Namen. Die alten Namen
 * funktionieren als Fallback weiter (siehe applyLegacyEnvFallback unten),
 * lösen aber beim Start eine Warnung aus. Exportiert, damit Tests die
 * Zuordnung und den Fallback-Mechanismus prüfen können.
 */
export const LEGACY_ENV_NAMES: Record<string, string> = {
  OVP_LLM_BASE_URL: 'LITELLM_BASE_URL',
  OVP_LLM_API_KEY: 'LITELLM_API_KEY',
  OVP_DEFAULT_MODEL: 'DEFAULT_MODEL',
  OVP_MODEL_ALLOWLIST: 'MODEL_ALLOWLIST',
  OVP_ALLOWED_ORIGINS: 'ALLOWED_ORIGINS',
  OVP_SERVE_STATIC_DIR: 'SERVE_STATIC_DIR',
  OVP_API_AUTH_TOKEN: 'API_AUTH_TOKEN',
  OVP_ADMIN_TOKEN: 'ADMIN_TOKEN',
  OVP_DATABASE_URL: 'MEMORY_DATABASE_URL',
  OVP_DATABASE_PATH: 'MEMORY_DB_PATH',
  OVP_MEMORY_MODEL: 'MEMORY_MODEL',
  OVP_SCOPE_GUARD: 'SCOPE_GUARD',
  OVP_SCOPE_MODEL: 'SCOPE_MODEL',
  OVP_LOG_LEVEL: 'LOG_LEVEL',
  OVP_AUTH_MODE: 'AUTH_MODE',
  OVP_PUBLIC_URL: 'PUBLIC_URL',
  OVP_OIDC_PROVIDER: 'OIDC_PROVIDER',
  OVP_OIDC_ISSUER: 'OIDC_ISSUER',
  OVP_OIDC_CLIENT_ID: 'OIDC_CLIENT_ID',
  OVP_OIDC_CLIENT_SECRET: 'OIDC_CLIENT_SECRET',
  OVP_OIDC_SCOPES: 'OIDC_SCOPES',
  OVP_APP_VERSION: 'APP_VERSION',
};

/** Kehrrichtung von LEGACY_ENV_NAMES (alter Name → neuer Name), für die Warnmeldung. */
const LEGACY_ENV_NAMES_REVERSE: Record<string, string> = Object.fromEntries(
  Object.entries(LEGACY_ENV_NAMES).map(([newName, oldName]) => [oldName, newName]),
);

/**
 * Wendet den Fallback auf die alten Env-Namen an: Ist ein neuer Schlüssel
 * nicht gesetzt (undefined oder leer), aber der alte gesetzt, übernimmt der
 * neue Name dessen Wert. Ist der neue Schlüssel gesetzt, gewinnt er —
 * unabhängig vom alten Wert. Gibt zusätzlich zurück, welche alten Namen
 * tatsächlich als Fallback verwendet wurden (für die Startup-Warnung).
 */
function applyLegacyEnvFallback(env: NodeJS.ProcessEnv): {
  resolved: NodeJS.ProcessEnv;
  legacyUsed: string[];
} {
  const resolved: NodeJS.ProcessEnv = { ...env };
  const legacyUsed: string[] = [];
  for (const [newName, oldName] of Object.entries(LEGACY_ENV_NAMES)) {
    const hasNew = resolved[newName] !== undefined && resolved[newName] !== '';
    const oldValue = env[oldName];
    if (!hasNew && oldValue !== undefined && oldValue !== '') {
      resolved[newName] = oldValue;
      legacyUsed.push(oldName);
    }
  }
  return { resolved, legacyUsed };
}

const envSchema = z.object({
  OVP_LLM_BASE_URL: z.string().url({ message: 'OVP_LLM_BASE_URL muss eine gültige URL sein' }),
  OVP_LLM_API_KEY: z.string().min(1, 'OVP_LLM_API_KEY fehlt'),
  OVP_DEFAULT_MODEL: z.string().min(1, 'OVP_DEFAULT_MODEL fehlt'),
  OVP_MODEL_ALLOWLIST: z.string().optional(),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  /** Override für PORT (Plattform-Konvention bleibt PORT, z. B. Kubernetes/Cloud Run). */
  OVP_PORT: z.coerce.number().int().min(1).max(65535).optional(),
  OVP_ALLOWED_ORIGINS: z.string().optional(),
  OVP_SERVE_STATIC_DIR: z.string().optional(),
  OVP_API_AUTH_TOKEN: z.string().optional(),
  OVP_ADMIN_TOKEN: z.string().optional(),
  OVP_DATABASE_URL: z.string().optional(),
  OVP_DATABASE_PATH: z.string().optional(),
  OVP_MEMORY_MODEL: z.string().optional(),
  OVP_SCOPE_GUARD: z.enum(['on', 'off']).default('on'),
  OVP_SCOPE_MODEL: z.string().optional(),
  OVP_LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  // --- Enterprise (ee/): Anmeldung & Lizenz ---
  // Leerer Wert = nicht gesetzt. .env.example liefert die Schlüssel bewusst
  // ohne Wert aus; ohne diese Umdeutung scheitert der dokumentierte Erststart
  // („cp .env.example .env") an einem leeren Enum-Wert.
  OVP_AUTH_MODE: emptyAsUnset(z.enum(['none', 'token', 'local', 'oidc']).optional()),
  OVP_PUBLIC_URL: z.string().url().optional().or(z.literal('')),
  OVP_OIDC_PROVIDER: emptyAsUnset(z.enum(['entra', 'keycloak', 'generic']).default('generic')),
  OVP_OIDC_ISSUER: z.string().url().optional().or(z.literal('')),
  OVP_OIDC_CLIENT_ID: z.string().optional(),
  OVP_OIDC_CLIENT_SECRET: z.string().optional(),
  OVP_OIDC_SCOPES: z.string().default('openid profile email'),
  OVP_LICENSE: z.string().optional(),
  /** Produktversion für den Heartbeat (Helm setzt sie aus der Chart-AppVersion). */
  OVP_APP_VERSION: z.string().optional(),
  OVP_LICENSE_PATH: z.string().optional(),
  OVP_LICENSE_PUBLIC_KEY_B64URL: z.string().optional(),
  OVP_LICENSE_PUBLIC_KEY_PATH: z.string().optional(),
  /** Schlüssel für im Web gespeicherte Secrets (aktuell: Tableau Connected-App-Secrets), siehe ee/server/src/secrets.ts. Optional — ohne ihn bleiben nur Env-Secret-Referenzen nutzbar. */
  OVP_SECRET_KEY: emptyAsUnset(z.string().min(32, 'OVP_SECRET_KEY muss mindestens 32 Zeichen lang sein').optional()),
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
   * Default an; OVP_SCOPE_GUARD=off schaltet ihn ab.
   */
  scopeGuardEnabled: boolean;
  /** Modell für den Scope-Guard (Default: memoryModel; günstiges Modell empfohlen). */
  scopeModel: string;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  /**
   * Zugriffsschutz für /api/*: 'none' (nur Netzwerk), 'token' (OVP_API_AUTH_TOKEN,
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
  const { resolved, legacyUsed } = applyLegacyEnvFallback(env);
  if (legacyUsed.length > 0) {
    const lines = legacyUsed.map((oldName) => `${oldName} ist veraltet — bitte ${LEGACY_ENV_NAMES_REVERSE[oldName]} verwenden`);
    console.warn(`Veraltete Umgebungsvariablen verwendet:\n  ${lines.join('\n  ')}`);
  }
  const parsed = envSchema.safeParse(resolved);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Ungültige Konfiguration (.env prüfen, Vorlage: .env.example):\n${details}`);
  }
  const e = parsed.data;
  const allowlist = splitCsv(e.OVP_MODEL_ALLOWLIST);
  const apiAuthToken = e.OVP_API_AUTH_TOKEN?.trim() ? e.OVP_API_AUTH_TOKEN.trim() : null;
  const authMode = e.OVP_AUTH_MODE ?? (apiAuthToken ? 'token' : 'none');
  if (authMode === 'token' && !apiAuthToken) {
    throw new Error('OVP_AUTH_MODE=token verlangt ein OVP_API_AUTH_TOKEN');
  }
  // OIDC-Daten dürfen auch später aus der Admin-UI kommen — ohne sie bleibt
  // der Modus fail-closed (auth-state.ts), kein Startabbruch nötig.
  return {
    litellmBaseUrl: e.OVP_LLM_BASE_URL.replace(/\/$/, ''),
    litellmApiKey: e.OVP_LLM_API_KEY,
    defaultModel: e.OVP_DEFAULT_MODEL,
    modelAllowlist: allowlist.length > 0 ? allowlist : null,
    port: e.OVP_PORT ?? e.PORT,
    allowedOrigins: splitCsv(e.OVP_ALLOWED_ORIGINS),
    serveStaticDir: e.OVP_SERVE_STATIC_DIR?.trim() ? e.OVP_SERVE_STATIC_DIR.trim() : null,
    apiAuthToken,
    adminToken: e.OVP_ADMIN_TOKEN?.trim() ? e.OVP_ADMIN_TOKEN.trim() : null,
    memoryDatabaseUrl: e.OVP_DATABASE_URL?.trim() ? e.OVP_DATABASE_URL.trim() : null,
    memoryDbPath: e.OVP_DATABASE_PATH?.trim() ? e.OVP_DATABASE_PATH.trim() : null,
    memoryModel: e.OVP_MEMORY_MODEL?.trim() ? e.OVP_MEMORY_MODEL.trim() : e.OVP_DEFAULT_MODEL,
    scopeGuardEnabled: e.OVP_SCOPE_GUARD === 'on',
    scopeModel:
      e.OVP_SCOPE_MODEL?.trim() ||
      (e.OVP_MEMORY_MODEL?.trim() ? e.OVP_MEMORY_MODEL.trim() : e.OVP_DEFAULT_MODEL),
    logLevel: e.OVP_LOG_LEVEL,
    authMode,
    publicUrl: e.OVP_PUBLIC_URL?.trim() ? e.OVP_PUBLIC_URL.trim().replace(/\/$/, '') : null,
    // OIDC-Defaults aus der Env, sobald Issuer UND Client-ID gesetzt sind —
    // unabhängig vom Modus (die Admin-UI kann später auf SSO umschalten).
    // Fehlen sie bei OVP_AUTH_MODE=oidc, bleibt die API fail-closed (auth-state.ts).
    oidc:
      e.OVP_OIDC_ISSUER?.trim() && e.OVP_OIDC_CLIENT_ID?.trim()
        ? {
            provider: e.OVP_OIDC_PROVIDER,
            issuer: e.OVP_OIDC_ISSUER.trim().replace(/\/$/, ''),
            clientId: e.OVP_OIDC_CLIENT_ID.trim(),
            clientSecret: e.OVP_OIDC_CLIENT_SECRET?.trim() ? e.OVP_OIDC_CLIENT_SECRET.trim() : null,
            scopes: e.OVP_OIDC_SCOPES.trim() || 'openid profile email',
          }
        : null,
    telemetryEndpoint: HEARTBEAT_ENDPOINT,
    appVersion: e.OVP_APP_VERSION?.trim() || 'unbekannt',
    licenseEnv: {
      OVP_LICENSE: e.OVP_LICENSE,
      OVP_LICENSE_PATH: e.OVP_LICENSE_PATH,
      OVP_LICENSE_PUBLIC_KEY_B64URL: e.OVP_LICENSE_PUBLIC_KEY_B64URL,
      OVP_LICENSE_PUBLIC_KEY_PATH: e.OVP_LICENSE_PUBLIC_KEY_PATH,
    },
  };
}
