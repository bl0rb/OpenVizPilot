import { z } from 'zod';
import { decryptSecret, encryptSecret, type EncryptedSecret } from '../secrets';
import { TableauError } from './errors';

const HTTPS_ORIGIN_MAX_LENGTH = 2048;
const SECRET_ENV_PATTERN = /^OVP_TABLEAU_[A-Z0-9_]+$/;
/** Site-Kürzel: kurz, URL-/Objektschlüssel-tauglich, menschenlesbar genug für Log/UI. */
const SITE_SLUG_PATTERN = /^[a-z][a-z0-9-]{0,16}$/;
const MAX_SITES = 50;
/** Deckt die Dashboard-Schlüssel-Länge aus packages/shared (MAX_DASHBOARD_KEY_CHARS) ab, ohne die Abhängigkeit einzuführen. */
const MAX_DASHBOARD_KEY_LENGTH = 200;

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
const encryptedSecretSchema = z.object({
  v: z.literal(1),
  iv: z.string().min(1).max(64),
  tag: z.string().min(1).max(64),
  data: z.string().min(1).max(8192),
}).strict();

// Feldschemas sind für beide `authMode`-Werte gleich locker gefasst (kein Feld wird
// hier je Modus zwingend gemacht) — die je Modus zwingenden Felder erzwingt der
// `superRefine` unten. So bleibt `TableauConfig` weiterhin ein einfacher
// enabled/disabled-Union (Direct Trust bleibt strukturell unverändert), und Code,
// der `config.siteId` oder `config.clientId` liest, muss nicht erst nach `authMode`
// verzweigen, um auf ein vorhandenes Feld zuzugreifen.
//
// `TableauConfig` ist die FLACHE Laufzeit-Sicht auf genau EINE Site (siteContentUrl,
// clientId, secretId, secretEnv, secret, siteId) plus die globalen Felder (serverUrl,
// usernameClaim, apiVersion, revision) — unverändert seit Phase 1 und weiterhin die
// einzige Config-Form, die TableauClient/TableauRest/TableauMetadata kennen. Die
// PERSISTIERTE, mehrsitige Form ist `TableauServerConfig` (sites[] + dashboardSites)
// weiter unten; `TableauService` baut daraus je aufgelöster Site ein `TableauConfig`.
const enabledConfigFields = {
  enabled: z.literal(true),
  serverUrl: serverUrlSchema,
  siteContentUrl: siteContentUrlSchema.default(''),
  clientId: z.string().max(500).default(''),
  secretId: z.string().max(500).default(''),
  secretEnv: z.union([secretEnvSchema, z.literal('')]).default(''),
  /** Verschlüsseltes DB-Secret (serverseitig gesetzt) — hat Vorrang vor secretEnv, siehe resolveTableauSecret. */
  secret: encryptedSecretSchema.optional(),
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
  secret: encryptedSecretSchema.optional(),
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
function checkEnabledAuthMode(config: { enabled: boolean; authMode: string; clientId: string; secretId: string; secretEnv: string; siteId: string; secret?: EncryptedSecret }, ctx: z.RefinementCtx): void {
  if (!config.enabled) return;
  if (config.authMode === 'oauth2-trust') {
    if (!siteIdSchema.safeParse(config.siteId).success) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['siteId'], message: 'siteId must be the Tableau site LUID (UUID) when authMode is oauth2-trust' });
    }
    return;
  }
  if (config.clientId.trim().length === 0) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['clientId'], message: 'clientId is required when authMode is connected-app' });
  if (config.secretId.trim().length === 0) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['secretId'], message: 'secretId is required when authMode is connected-app' });
  // Ein verschlüsseltes DB-Secret (Teil B, `resolveTableauSecret`) ist eine gültige Alternative zur
  // Env-Referenz — sonst würde TableauClient (baut sein flaches Config aus einer aufgelösten Site)
  // hier fälschlich ablehnen, obwohl die Site nur ein Web-Secret ohne secretEnv trägt.
  if (!config.secret && !secretEnvSchema.safeParse(config.secretEnv).success) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['secretEnv'], message: 'secretEnv is required when authMode is connected-app and no secret is stored' });
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

/**
 * Löst das Secret einer Site auf: verschlüsseltes DB-Secret (entschlüsselt) hat Vorrang,
 * sonst die Env-Referenz. Wirft `TABLEAU_SECRET_UNAVAILABLE` (Secret nicht entschlüsselbar
 * bzw. Env-Wert fehlt) oder `TABLEAU_CONFIG_INVALID` (weder Secret noch gültige Env-Referenz
 * konfiguriert). Der Klartext wird nie geloggt.
 */
export function resolveTableauSecret(site: { secret?: EncryptedSecret; secretEnv: string }, env: NodeJS.ProcessEnv = process.env): string {
  if (site.secret) {
    try {
      return decryptSecret(site.secret, env);
    } catch {
      throw new TableauError('TABLEAU_SECRET_UNAVAILABLE');
    }
  }
  if (!isTableauSecretEnv(site.secretEnv)) throw new TableauError('TABLEAU_CONFIG_INVALID');
  const secret = env[site.secretEnv];
  if (typeof secret !== 'string' || secret.length === 0) throw new TableauError('TABLEAU_SECRET_UNAVAILABLE');
  return secret;
}

// ---------------------------------------------------------------------------
// Mehrsitige, persistierte Konfiguration (Teil B): eine Tableau-Server-Instanz
// (globale Felder), mehrere Sites (je eigene Connected App), Dashboard→Site-
// Zuordnung. `TableauService` löst je Aufruf eine Site auf und baut daraus das
// obige, unveränderte flache `TableauConfig` für TableauClient/-Rest/-Metadata.
// ---------------------------------------------------------------------------

const slugSchema = z.string().regex(SITE_SLUG_PATTERN);
const siteNameSchema = z.string().trim().min(1).max(200);

const tableauSiteBaseFields = {
  id: slugSchema,
  name: siteNameSchema,
  /** Leer = Default-Site (Tableau Server); Tableau Cloud verlangt immer einen Wert. */
  contentUrl: siteContentUrlSchema.default(''),
  authMode: authModeSchema.default('connected-app'),
  clientId: z.string().max(500).default(''),
  secretId: z.string().max(500).default(''),
  secretEnv: z.union([secretEnvSchema, z.literal('')]).default(''),
  /** Site-LUID; nur für `oauth2-trust` zwingend. */
  siteId: z.union([siteIdSchema, z.literal('')]).default(''),
} as const;

/** Persistierte Site — Secret liegt (falls im Web gesetzt) nur verschlüsselt vor. */
export const tableauSiteSchema = z.object({ ...tableauSiteBaseFields, secret: encryptedSecretSchema.optional() }).strict();
export type TableauSite = z.infer<typeof tableauSiteSchema>;

/** Site aus einem PUT-Body: `secret` ist (falls gesetzt) der Klartext, `secretClear` löscht das DB-Secret. */
export const tableauSiteInputSchema = z.object({
  ...tableauSiteBaseFields,
  secret: z.string().min(1).max(4096).optional(),
  secretClear: z.boolean().optional(),
}).strict();
export type TableauSiteInput = z.infer<typeof tableauSiteInputSchema>;

const dashboardSitesSchema = z.record(z.string().min(1).max(MAX_DASHBOARD_KEY_LENGTH), z.string()).default({});

function checkSiteAuthMode(site: { authMode: string; clientId: string; secretId: string; siteId: string }, ctx: z.RefinementCtx, index: number): void {
  if (site.authMode === 'oauth2-trust') {
    if (!siteIdSchema.safeParse(site.siteId).success) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['sites', index, 'siteId'], message: 'siteId must be the Tableau site LUID (UUID) when authMode is oauth2-trust' });
    }
    return;
  }
  if (site.clientId.trim().length === 0) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['sites', index, 'clientId'], message: 'clientId is required when authMode is connected-app' });
  if (site.secretId.trim().length === 0) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['sites', index, 'secretId'], message: 'secretId is required when authMode is connected-app' });
}

/** Referentielle Integrität, unabhängig von `enabled`: eindeutige IDs/Content-URLs, dashboardSites zeigt auf existierende Sites. */
function checkSitesShared(sites: readonly { id: string; contentUrl: string }[], dashboardSites: Record<string, string>, ctx: z.RefinementCtx): void {
  const ids = new Set<string>();
  const contentUrls = new Set<string>();
  sites.forEach((site, index) => {
    if (ids.has(site.id)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['sites', index, 'id'], message: 'Site-ID must be unique' });
    ids.add(site.id);
    if (contentUrls.has(site.contentUrl)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['sites', index, 'contentUrl'], message: 'Site content URL must be unique' });
    contentUrls.add(site.contentUrl);
  });
  for (const [dashboardKey, siteId] of Object.entries(dashboardSites)) {
    if (!ids.has(siteId)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['dashboardSites', dashboardKey], message: 'dashboardSites must reference a configured site' });
  }
}

function checkEnabledSites(config: {
  enabled: boolean;
  sites: readonly { authMode: string; clientId: string; secretId: string; siteId: string; id: string; contentUrl: string }[];
  dashboardSites: Record<string, string>;
}, ctx: z.RefinementCtx): void {
  checkSitesShared(config.sites, config.dashboardSites, ctx);
  if (!config.enabled) return;
  config.sites.forEach((site, index) => checkSiteAuthMode(site, ctx, index));
}

/** Migriert einen alten Einzel-Site-Blob (vor Teil B) zu `{ sites: [...] }`, sobald keine `sites`-Liste vorliegt. */
function migrateLegacyTableauBlob(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || 'sites' in raw) return raw;
  const value = raw as Record<string, unknown>;
  const siteContentUrl = typeof value.siteContentUrl === 'string' ? value.siteContentUrl : '';
  const legacySite = {
    id: 'default',
    name: siteContentUrl || 'Standard-Site',
    contentUrl: siteContentUrl,
    authMode: value.authMode === 'oauth2-trust' ? 'oauth2-trust' : 'connected-app',
    clientId: typeof value.clientId === 'string' ? value.clientId : '',
    secretId: typeof value.secretId === 'string' ? value.secretId : '',
    secretEnv: typeof value.secretEnv === 'string' ? value.secretEnv : '',
    siteId: typeof value.siteId === 'string' ? value.siteId : '',
  };
  return {
    enabled: value.enabled,
    serverUrl: value.serverUrl,
    usernameClaim: value.usernameClaim,
    apiVersion: value.apiVersion,
    revision: value.revision,
    sites: [legacySite],
    dashboardSites: {},
  };
}

const enabledServerFields = {
  enabled: z.literal(true),
  serverUrl: serverUrlSchema,
  usernameClaim: nonEmptyConfigString,
  apiVersion: apiVersionSchema,
  revision: z.string().uuid(),
  sites: z.array(tableauSiteSchema).max(MAX_SITES).default([]),
  dashboardSites: dashboardSitesSchema,
} as const;

const disabledServerFields = {
  enabled: z.literal(false),
  serverUrl: z.union([serverUrlSchema, z.literal('')]).default(''),
  usernameClaim: z.string().max(500).default(''),
  apiVersion: apiVersionSchema.default(TABLEAU_REST_API_VERSION),
  revision: z.string().uuid(),
  sites: z.array(tableauSiteSchema).max(MAX_SITES).default([]),
  dashboardSites: dashboardSitesSchema,
} as const;

const tableauServerConfigShape = z.discriminatedUnion('enabled', [
  z.object(enabledServerFields).strict(),
  z.object(disabledServerFields).strict(),
]).superRefine(checkEnabledSites);

/** Persistierte Wurzel-Konfiguration: globale Felder + Sites + Dashboard-Zuordnung. */
export const tableauServerConfigSchema = z.preprocess(migrateLegacyTableauBlob, tableauServerConfigShape);
export type TableauServerConfig = z.infer<typeof tableauServerConfigShape>;

const enabledServerInputFields = {
  enabled: z.literal(true),
  serverUrl: serverUrlSchema,
  usernameClaim: nonEmptyConfigString,
  apiVersion: apiVersionSchema,
  sites: z.array(tableauSiteInputSchema).max(MAX_SITES).default([]),
  dashboardSites: dashboardSitesSchema,
} as const;

const disabledServerInputFields = {
  enabled: z.literal(false),
  serverUrl: z.union([serverUrlSchema, z.literal('')]).default(''),
  usernameClaim: z.string().max(500).default(''),
  apiVersion: apiVersionSchema.default(TABLEAU_REST_API_VERSION),
  sites: z.array(tableauSiteInputSchema).max(MAX_SITES).default([]),
  dashboardSites: dashboardSitesSchema,
} as const;

/** PUT-Body: keine `revision` (die vergibt der Store), Sites tragen Klartext-`secret`/`secretClear` statt der verschlüsselten Box. */
export const tableauServerConfigInputSchema = z.discriminatedUnion('enabled', [
  z.object(enabledServerInputFields).strict(),
  z.object(disabledServerInputFields).strict(),
]).superRefine(checkEnabledSites);
export type TableauServerConfigInput = z.infer<typeof tableauServerConfigInputSchema>;

/**
 * Baut aus einer Input-Site die zu persistierende Site: verschlüsselt ein mitgesendetes
 * Klartext-Secret, löscht es bei `secretClear`, oder behält andernfalls das zuvor
 * gespeicherte Secret derselben Site-ID bei (kein Feld gesendet = unverändert).
 */
export function encryptTableauSiteSecret(input: TableauSiteInput, previous: TableauSite | undefined, env: NodeJS.ProcessEnv = process.env): TableauSite {
  const { secret: plainSecret, secretClear, ...rest } = input;
  if (secretClear) return { ...rest };
  if (typeof plainSecret === 'string' && plainSecret.length > 0) return { ...rest, secret: encryptSecret(plainSecret, env) };
  if (previous && previous.id === rest.id && previous.secret) return { ...rest, secret: previous.secret };
  return { ...rest };
}

/**
 * Löst eine Site auf: explizite `siteId` (Admin-Werkzeuge) zuerst, sonst die per
 * `dashboardKey` zugeordnete Site, sonst — wenn genau eine Site konfiguriert ist —
 * diese eine Site. Sonst `TABLEAU_SITE_UNRESOLVED` (mehrdeutig oder keine Site).
 */
export function resolveTableauSite(config: TableauServerConfig, selector: { siteId?: string; dashboardKey?: string } = {}): TableauSite {
  if (selector.siteId) {
    const site = config.sites.find((candidate) => candidate.id === selector.siteId);
    if (site) return site;
    throw new TableauError('TABLEAU_SITE_UNRESOLVED');
  }
  if (selector.dashboardKey) {
    const mappedId = config.dashboardSites[selector.dashboardKey];
    const site = mappedId ? config.sites.find((candidate) => candidate.id === mappedId) : undefined;
    if (site) return site;
  }
  if (config.sites.length === 1) return config.sites[0]!;
  throw new TableauError('TABLEAU_SITE_UNRESOLVED');
}
