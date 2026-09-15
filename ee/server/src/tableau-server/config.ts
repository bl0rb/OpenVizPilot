import { z } from 'zod';
import { TableauError } from './errors';

const HTTPS_ORIGIN_MAX_LENGTH = 2048;
const SECRET_ENV_PATTERN = /^OVP_TABLEAU_[A-Z0-9_]+$/;

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

const enabledConfigFields = {
  enabled: z.literal(true),
  serverUrl: serverUrlSchema,
  siteContentUrl: siteContentUrlSchema.default(''),
  clientId: nonEmptyConfigString,
  secretId: nonEmptyConfigString,
  secretEnv: secretEnvSchema,
  usernameClaim: nonEmptyConfigString,
  revision: z.string().uuid(),
  apiVersion: z.literal('3.27'),
  authMode: z.literal('connected-app'),
} as const;

const disabledConfigFields = {
  enabled: z.literal(false),
  serverUrl: z.union([serverUrlSchema, z.literal('')]).default(''),
  siteContentUrl: siteContentUrlSchema.default(''),
  clientId: z.string().max(500).default(''),
  secretId: z.string().max(500).default(''),
  secretEnv: z.union([secretEnvSchema, z.literal('')]).default(''),
  usernameClaim: z.string().max(500).default(''),
  revision: z.string().uuid(),
  apiVersion: z.literal('3.27').default('3.27'),
  authMode: z.literal('connected-app').default('connected-app'),
} as const;

export const tableauConfigSchema = z.discriminatedUnion('enabled', [
  z.object(enabledConfigFields).strict(),
  z.object(disabledConfigFields).strict(),
]);
export type TableauConfig = z.infer<typeof tableauConfigSchema>;

const tableauConfigCompleteInputSchema = z.object(enabledConfigFields).omit({ revision: true }).strict();
const tableauConfigDisabledInputSchema = z.object(disabledConfigFields).omit({ revision: true }).strict();

/** Complete settings for enablement, or deliberately incomplete settings while disabled. */
export const tableauConfigInputSchema = z.discriminatedUnion('enabled', [
  tableauConfigCompleteInputSchema.extend({ enabled: z.literal(true) }),
  tableauConfigDisabledInputSchema,
]);

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
