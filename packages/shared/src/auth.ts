import { z } from 'zod';

/**
 * Anmeldung an der Middleware — Vertrag zwischen Extension, Server und
 * Admin-UI.
 *
 * Modi: 'none' (nur Netzwerkschutz), 'token' (API_AUTH_TOKEN, nur per Env),
 * 'local' (Benutzerkonten aus der Admin-UI — Open Core) und 'oidc'
 * (Single Sign-On per Entra ID/Keycloak — Enterprise, lizenzpflichtig).
 */

export const AUTH_MODES = ['none', 'token', 'local', 'oidc'] as const;
export const authModeSchema = z.enum(AUTH_MODES);
export type AuthMode = z.infer<typeof authModeSchema>;

export const OIDC_PROVIDERS = ['entra', 'keycloak', 'generic'] as const;
export const oidcProviderSchema = z.enum(OIDC_PROVIDERS);
export type OidcProvider = z.infer<typeof oidcProviderSchema>;

export const oidcSettingsSchema = z.object({
  provider: oidcProviderSchema,
  issuer: z.string().url().max(500),
  clientId: z.string().min(1).max(200),
  /** Nur confidential clients; write-only in der Admin-UI. */
  clientSecret: z.string().max(500).optional(),
  scopes: z.string().min(1).max(200).default('openid profile email'),
});
export type OidcSettings = z.infer<typeof oidcSettingsSchema>;

/** In der Admin-UI gepflegte Einstellungen (DB, überschreiben die Env-Defaults). */
export const authSettingsSchema = z.object({
  mode: z.enum(['none', 'local', 'oidc']),
  oidc: oidcSettingsSchema.optional(),
  /** Signierter Enterprise-Lizenzschlüssel. */
  license: z.string().max(8000).optional(),
  /** Öffentlicher Origin der Middleware (Redirect-URI für SSO), z. B. https://chat.example.com. */
  publicUrl: z.string().url().max(500).optional(),
});
export type AuthSettings = z.infer<typeof authSettingsSchema>;

/** Antwort von GET /api/auth/config — steuert das Login-Gate der Extension. */
export interface AuthConfigResponse {
  mode: AuthMode;
  provider?: OidcProvider;
  providerLabel?: string;
  authorizationEndpoint?: string;
  clientId?: string;
  scopes?: string;
  redirectUri?: string;
  /** z. B. IdP nicht erreichbar oder Lizenz abgelaufen — Login nicht möglich. */
  error?: string;
}

export const MIN_USER_PASSWORD_CHARS = 10;
export const USERNAME_PATTERN = /^[a-z0-9._@-]{2,100}$/i;

export const localLoginSchema = z.object({
  username: z.string().min(1).max(100),
  password: z.string().min(1).max(200),
});

export const createUserSchema = z.object({
  username: z.string().regex(USERNAME_PATTERN, 'Nur Buchstaben, Ziffern, . _ @ -, 2–100 Zeichen'),
  displayName: z.string().max(100).optional(),
  password: z.string().min(MIN_USER_PASSWORD_CHARS).max(200),
});

export const setPasswordSchema = z.object({
  password: z.string().min(MIN_USER_PASSWORD_CHARS).max(200),
});

export interface AuthSession {
  token: string;
  /** Epoch-Millisekunden. */
  expiresAt: number;
  user: { name?: string; email?: string };
}
