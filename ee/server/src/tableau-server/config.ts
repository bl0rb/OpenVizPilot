import { z } from 'zod';
import { TableauError } from './errors';

const HTTPS_ORIGIN_MAX_LENGTH = 2048;
const SECRET_ENV_PATTERN = /^OVP_TABLEAU_[A-Z0-9_]+$/;

/** Fixed REST request version: the version of the oldest supported server; every connector primitive exists in it. */
export const TABLEAU_REST_API_VERSION = '3.23';
export const TABLEAU_MIN_SERVER_VERSION = '2024.2';
/** '3.27' stays readable for settings persisted while that was the request version and normalizes to the fixed one. */
const apiVersionSchema = z.enum([TABLEAU_REST_API_VERSION, '3.27']).transform(() => TABLEAU_REST_API_VERSION);

function isHttpsOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      && !url.username
      && !url.password
      && !url.search
      && !url.hash
      && url.pathname === '/'
      && (value === url.origin || value === `${url.origin}/`);
  } catch {
    return false;
  }
}

const serverUrlSchema = z.string().max(HTTPS_ORIGIN_MAX_LENGTH).refine(isHttpsOrigin, 'serverUrl must be an HTTPS origin');
const siteContentUrlSchema = z.string().max(200);
const nonEmptyConfigString = z.string().trim().min(1);
const secretEnvSchema = z.string().regex(SECRET_ENV_PATTERN);
/** Tableau Site-LUID (aus dem Connected-App-Dialog nach dem Anlegen), UUID-Format. */
const siteIdSchema = z.string().uuid();
const authModeSchema = z.enum(['connected-app', 'oauth2-trust']);

// Feldschemas sind für beide `authMode`-Werte gleich locker gefasst (kein Feld wird
// hier je Modus zwingend gemacht) — die je Modus zwingenden Felder erzwingt der
// `superRefine` unten. So bleibt `TableauConfig` weiterhin ein einfacher
// enabled/disabled-Union (Direct Trust bleibt strukturell unverändert), und Code,
// der `config.siteId` oder `config.clientId` liest, muss nicht erst nach `authMode`
// verzweigen, um auf ein vorhandenes Feld zuzugreifen.
const enabledConfigFields = {
  enabled: z.literal(true),
  serverUrl: serverUrlSchema,
  siteContentUrl: siteContentUrlSchema.default(''),
  clientId: z.string().max(500).default(''),
  secretId: z.string().max(500).default(''),
  secretEnv: z.union([secretEnvSchema, z.literal('')]).default(''),
  usernameClaim: nonEmptyConfigString,
  /** Nur für `oauth2-trust` zwingend (Site-LUID); bei `connected-app` unbenutzt. */
  siteId: z.union([siteIdSchema, z.literal('')]).default(''),
  revision: z.string().uuid(),
  apiVersion: apiVersionSchema,
  authMode: authModeSchema.default('connected-app'),
} as const;

const disabledConfigFields = {
  enabled: z.literal(false),
  serverUrl: z.union([serverUrlSchema, z.literal('')]).default(''),
  siteContentUrl: siteContentUrlSchema.default(''),
  clientId: z.string().max(500).default(''),
  secretId: z.string().max(500).default(''),
  secretEnv: z.union([secretEnvSchema, z.literal('')]).default(''),
  usernameClaim: z.string().max(500).default(''),
  siteId: z.union([siteIdSchema, z.literal('')]).default(''),
  revision: z.string().uuid(),
  apiVersion: apiVersionSchema.default(TABLEAU_REST_API_VERSION),
  authMode: authModeSchema.default('connected-app'),
} as const;

/**
 * Je `authMode` zwingende Felder, sobald `enabled: true` — Direct Trust unverändert
 * (clientId/secretId/secretEnv), OAuth 2.0 Trust verlangt stattdessen eine gültige
 * Site-LUID; die jeweils andere Gruppe bleibt leer und wird ignoriert.
 */
function checkEnabledAuthMode(config: { enabled: boolean; authMode: string; clientId: string; secretId: string; secretEnv: string; siteId: string }, ctx: z.RefinementCtx): void {
  if (!config.enabled) return;
  if (config.authMode === 'oauth2-trust') {
    if (!siteIdSchema.safeParse(config.siteId).success) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['siteId'], message: 'siteId must be the Tableau site LUID (UUID) when authMode is oauth2-trust' });
    }
    return;
  }
  if (config.clientId.trim().length === 0) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['clientId'], message: 'clientId is required when authMode is connected-app' });
  if (config.secretId.trim().length === 0) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['secretId'], message: 'secretId is required when authMode is connected-app' });
  if (!secretEnvSchema.safeParse(config.secretEnv).success) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['secretEnv'], message: 'secretEnv is required when authMode is connected-app' });
  }
}

export const tableauConfigSchema = z.discriminatedUnion('enabled', [
  z.object(enabledConfigFields).strict(),
  z.object(disabledConfigFields).strict(),
]).superRefine(checkEnabledAuthMode);
export type TableauConfig = z.infer<typeof tableauConfigSchema>;

const tableauConfigCompleteInputSchema = z.object(enabledConfigFields).omit({ revision: true }).strict();
const tableauConfigDisabledInputSchema = z.object(disabledConfigFields).omit({ revision: true }).strict();

/** Complete settings for enablement, or deliberately incomplete settings while disabled. */
export const tableauConfigInputSchema = z.discriminatedUnion('enabled', [
  tableauConfigCompleteInputSchema.extend({ enabled: z.literal(true) }),
  tableauConfigDisabledInputSchema,
]).superRefine(checkEnabledAuthMode);

export type TableauConfigInput = z.infer<typeof tableauConfigInputSchema>;

export function parseTableauServerOrigin(serverUrl: string): URL {
  if (!isHttpsOrigin(serverUrl)) throw new Error('invalid Tableau HTTPS origin');
  return new URL(serverUrl);
}

export function isTableauSecretEnv(name: string): boolean {
  return SECRET_ENV_PATTERN.test(name);
}

/** Resolve only the explicitly configured, namespaced server-side secret reference. */
export function resolveTableauSecret(config: Pick<TableauConfig, 'secretEnv'>, env: NodeJS.ProcessEnv = process.env): string {
  if (!isTableauSecretEnv(config.secretEnv)) throw new TableauError('TABLEAU_CONFIG_INVALID');
  const secret = env[config.secretEnv];
  if (typeof secret !== 'string' || secret.length === 0) throw new TableauError('TABLEAU_SECRET_UNAVAILABLE');
  return secret;
}
