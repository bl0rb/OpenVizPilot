import { zValidator } from '@hono/zod-validator';
import {
  authSettingsSchema,
  buildTrexManifest,
  createUserSchema,
  DEFAULT_SLASH_COMMANDS,
  metricCatalogSchema,
  MIN_USER_PASSWORD_CHARS,
  modelCatalogSchema,
  playbookEntrySchema,
  setPasswordSchema,
  slashCommandListSchema,
  USERNAME_PATTERN,
  validateExtensionUrl,
  type AuthSettings,
} from '@openvizpilot/shared';
import {
  describeLicense,
  describeTelemetry,
  EE_FEATURE_LABELS,
  hasFeature,
  loadLicenseFromEnv,
  verifyLease,
  verifyLicense,
  type HeartbeatAction,
  type HeartbeatInstallation,
  type HeartbeatResponseInfo,
  type LicenseStatus,
  type TelemetryStore,
  createMcpAdminRoute,
  type McpStore,
  createTableauAdminRoute,
  createWatchAdminRoute,
  type WatchStore,
  OidcError,
  type TableauService,
  type VerifiedUser,
} from '@openvizpilot/ee/server';
import { Hono, type MiddlewareHandler } from 'hono';
import { timingSafeEqual } from 'node:crypto';
import type OpenAI from 'openai';
import { z } from 'zod';
import {
  ADMIN_SESSION_TTL_MS,
  hashPassword,
  hashSessionToken,
  LOGIN_FAILURE_WINDOW_MS,
  LOGIN_LOCKOUT_MS,
  LOGIN_MAX_FAILED_ATTEMPTS,
  MIN_ADMIN_PASSWORD_CHARS,
  newSessionToken,
  verifyPassword,
} from '../admin-auth';
import type { AuthStateProvider } from '../auth-state';
import type { AppConfig } from '../env';
import type { Logger } from '../logger';
import type { MemoryStore } from '../memory/store';
import { resolveUserAccess } from '../user-access';

/**
 * Admin-API: zentrale Verwaltung der Slash-Befehle, Manifest-Download und
 * Einsicht in die anonyme Nutzungsstatistik — Gegenstück zur Admin-UI unter
 * GET /admin (admin-page.ts). Vom Shared-Token für /api/chat & Co.
 * (OVP_API_AUTH_TOKEN) unabhängig — siehe app.ts, wo /api/admin/* explizit von
 * der OVP_API_AUTH_TOKEN-Middleware ausgenommen wird.
 *
 * Zwei Betriebsarten (auth-status meldet den Modus an die UI):
 * - **Token-Modus** (OVP_ADMIN_TOKEN gesetzt): statisches Bearer-Token wie
 *   bisher; Setup/Login sind deaktiviert.
 * - **Passwort-Modus** (kein OVP_ADMIN_TOKEN, aber Memory-Store vorhanden):
 *   Beim ERSTEN Zugriff legt der Anwender das Admin-Passwort selbst an
 *   (POST /setup, einmalig und race-sicher), danach Login mit Passwort und
 *   DB-gestützten Sessions (multi-replica-fähig) samt Lockout gegen
 *   Brute-Force — Muster wie in PaddleDoc.
 *
 * Ohne OVP_ADMIN_TOKEN UND ohne Store ist die gesamte Route deaktiviert (404) —
 * die Admin-Funktionalität existiert dann faktisch nicht.
 *
 * Rollen: Token bzw. Admin-Konto sind der **initiale Admin**. Zusätzlich (in
 * beiden Betriebsarten) kommt ein Benutzer-Token (lokale Sitzung bzw.
 * OIDC-ID-Token) durch, dessen Access-Record `admin: true` trägt — der
 * **delegierte Admin**. Nur der initiale Admin vergibt/entzieht die Rolle.
 *
 * DATENSCHUTZ: GET /stats liefert ausschließlich aggregierte Zähler
 * (Tag · Metrik · Key → Anzahl) — niemals Frage-/Antwort-Inhalte oder
 * User-IDs. Die Events selbst tragen ohnehin keine (siehe routes/stats.ts
 * und die Metrik-Whitelist in @openvizpilot/shared/usage.ts).
 */

const MIN_STATS_DAYS = 1;
const MAX_STATS_DAYS = 90;
const DEFAULT_STATS_DAYS = 30;

const passwordBodySchema = z.object({ password: z.string().min(1).max(200) });

/** Konstanter Vergleich gegen Timing-Angriffe auf den Admin-Token. */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function clampDays(raw: string | undefined): number {
  const parsed = raw ? Number.parseInt(raw, 10) : DEFAULT_STATS_DAYS;
  if (!Number.isFinite(parsed)) return DEFAULT_STATS_DAYS;
  return Math.min(MAX_STATS_DAYS, Math.max(MIN_STATS_DAYS, parsed));
}

/**
 * Mindest-Kohorte für Kennzahlen JE ANWENDER: Unterhalb dieser Anwenderzahl
 * wären Ø/Max faktisch die Fragenzahl einer einzelnen, aus dem Organisations-
 * kontext erratbaren Person — dann werden users/avgPerUser/maxPerUser
 * unterdrückt (null); die Fragen-Summe je Dashboard bleibt sichtbar.
 */
export const MIN_USER_COHORT = 3;

/**
 * Verdichtet (Dashboard · Pseudonym · Fragen) zu Kennzahlen pro Dashboard.
 * Pseudonyme verlassen den Server NICHT — nur Zähler. userToken '' steht für
 * Fragen ohne User-ID: zählen als Fragen, nicht als Anwender.
 */
export function aggregateDashboardUsage(
  rows: Array<{ dashboardKey: string; userToken: string; questions: number }>,
): Array<{
  dashboardKey: string;
  questions: number;
  users: number | null;
  avgPerUser: number | null;
  maxPerUser: number | null;
}> {
  const byDashboard = new Map<string, { questions: number; perUser: number[] }>();
  for (const row of rows) {
    const entry = byDashboard.get(row.dashboardKey) ?? { questions: 0, perUser: [] };
    entry.questions += row.questions;
    if (row.userToken !== '') entry.perUser.push(row.questions);
    byDashboard.set(row.dashboardKey, entry);
  }
  return [...byDashboard.entries()]
    .map(([dashboardKey, { questions, perUser }]) => {
      const users = perUser.length;
      if (users < MIN_USER_COHORT) {
        return { dashboardKey, questions, users: null, avgPerUser: null, maxPerUser: null };
      }
      const known = perUser.reduce((sum, n) => sum + n, 0);
      return {
        dashboardKey,
        questions,
        users,
        avgPerUser: Math.round((known / users) * 10) / 10,
        maxPerUser: Math.max(...perUser),
      };
    })
    .sort((a, b) => b.questions - a.questions);
}

export interface AdminPrincipal {
  role: 'initial' | 'delegated';
  name: string;
  provider: 'token' | 'admin' | 'local' | 'oidc';
}

export type AdminEnv = { Variables: { adminPrincipal: AdminPrincipal } };

function bearerToken(header: string | undefined): string | null {
  if (!header?.startsWith('Bearer ')) return null;
  const token = header.slice('Bearer '.length).trim();
  return token.length > 0 ? token : null;
}

export function createAdminRoute(
  config: AppConfig,
  memoryStore: MemoryStore | null,
  logger: Logger,
  client: OpenAI,
  authState: AuthStateProvider,
  /** Zustand des Lizenz-Heartbeats (ee/) — nur für die Anzeige. */
  telemetryStore: TelemetryStore | null = null,
  mcpStore: McpStore | null = null,
  tableau: TableauService | null = null,
  /** Speicher der Watch-Beobachtungsregeln (W6, ee/) — für die Admin-Übersicht/-Verwaltung. */
  watchStore: WatchStore | null = null,
  /** Sofortiger Lizenz-Heartbeat (neuer Schlüssel, „Jetzt aktualisieren“, Stilllegen/Übertragen); null ohne Datenbank. */
  refreshLease:
    | ((options?: { action?: HeartbeatAction; onResponse?: (info: HeartbeatResponseInfo) => void; reactivate?: boolean }) => Promise<'sent' | 'skipped' | 'failed'>)
    | null = null,
): Hono<AdminEnv> {
  const app = new Hono<AdminEnv>();
  const tokenMode = Boolean(config.adminToken);

  /**
   * Delegierter Admin: Benutzer-Token je nach aktivem Anmeldemodus auflösen
   * (lokale Sitzung bzw. verifiziertes OIDC-ID-Token) und den Access-Record
   * prüfen. null = kein gültiges Benutzer-Token bzw. gesperrtes Konto (401);
   * 'not_admin' = gültiges Konto ohne Admin-Rolle (403).
   */
  const resolveDelegatedAdmin = async (token: string): Promise<AdminPrincipal | 'not_admin' | null> => {
    if (!memoryStore) return null;
    const state = await authState.get();
    let identity: { oidc?: VerifiedUser; username?: string } | null = null;
    if (state.mode === 'local') {
      const username = await memoryStore.getUserSession(hashSessionToken(token), Date.now());
      if (username) identity = { username };
    } else if (state.mode === 'oidc' && state.oidc && !state.blockedReason) {
      try {
        identity = { oidc: await state.oidc.verifyIdToken(token) };
      } catch (err) {
        if (err instanceof OidcError && err.kind === 'config') throw err;
      }
    }
    if (!identity) return null;
    const record = await resolveUserAccess(memoryStore, identity);
    if (!record) return null;
    if (!record.admin) return 'not_admin';
    return { role: 'delegated', name: record.displayName || record.email || record.subject, provider: record.provider };
  };

  // Weder statisches Token noch Store für den Passwort-Modus: alles 404.
  app.use('*', async (c, next) => {
    if (!tokenMode && !memoryStore) {
      return c.json({ error: 'Admin-UI ist auf diesem Server nicht aktiviert' }, 404);
    }
    await next();
  });

  // ---- Öffentliche Auth-Endpunkte (VOR der Auth-Middleware registriert) ----

  app.get('/auth-status', async (c) => {
    if (tokenMode) return c.json({ mode: 'token' as const });
    try {
      const account = await memoryStore!.getAdminAccount();
      return c.json({ mode: account ? ('login' as const) : ('setup' as const) });
    } catch (err) {
      logger.error('admin auth-status failed', { name: err instanceof Error ? err.name : 'unknown' });
      return c.json({ error: 'Datenbank nicht erreichbar' }, 503);
    }
  });

  app.post(
    '/setup',
    zValidator('json', passwordBodySchema, (result, c) =>
      result.success ? undefined : c.json({ error: 'Ungültiger Request' }, 400),
    ),
    async (c) => {
      if (tokenMode) {
        return c.json({ error: 'Dieser Server nutzt ein statisches OVP_ADMIN_TOKEN' }, 400);
      }
      const { password } = c.req.valid('json');
      if (password.length < MIN_ADMIN_PASSWORD_CHARS) {
        return c.json(
          { error: `Passwort zu kurz — mindestens ${MIN_ADMIN_PASSWORD_CHARS} Zeichen` },
          400,
        );
      }
      let created = false;
      try {
        created = await memoryStore!.createAdminAccount(await hashPassword(password));
        if (!created) {
          return c.json({ error: 'Ersteinrichtung ist bereits abgeschlossen' }, 409);
        }
        const { token, tokenHash } = newSessionToken();
        await memoryStore!.createAdminSession(tokenHash, Date.now() + ADMIN_SESSION_TTL_MS);
        logger.info('admin account created via first-run setup');
        return c.json({ token });
      } catch (err) {
        logger.error('admin setup failed', { name: err instanceof Error ? err.name : 'unknown' });
        // Teilausfall: Konto steht schon, nur die Session kam nicht mehr in
        // die DB — dem Nutzer den korrekten nächsten Schritt nennen statt
        // ihn mit einem generischen Fehler im Setup-Formular zu lassen.
        if (created) {
          return c.json(
            { error: 'Konto wurde angelegt, aber die Anmeldung schlug fehl — bitte jetzt mit dem Passwort anmelden' },
            503,
          );
        }
        return c.json({ error: 'Datenbank nicht erreichbar' }, 503);
      }
    },
  );

  app.post(
    '/login',
    zValidator('json', passwordBodySchema, (result, c) =>
      result.success ? undefined : c.json({ error: 'Ungültiger Request' }, 400),
    ),
    async (c) => {
      if (tokenMode) {
        return c.json({ error: 'Dieser Server nutzt ein statisches OVP_ADMIN_TOKEN' }, 400);
      }
      const { password } = c.req.valid('json');
      try {
        const account = await memoryStore!.getAdminAccount();
        if (!account) {
          return c.json({ error: 'Ersteinrichtung steht noch aus' }, 409);
        }
        const now = Date.now();
        if (account.lockedUntil !== null && account.lockedUntil > now) {
          return c.json({ error: 'Zu viele Fehlversuche — bitte später erneut versuchen' }, 429);
        }
        if (!(await verifyPassword(password, account.passwordHash))) {
          // Fehlversuchs-Fenster wie in PaddleDoc: alte Streaks verfallen,
          // erst eine dichte Serie führt zur Sperre. Das Zählen läuft ATOMAR
          // in der DB — parallele Falsch-Logins akkumulieren korrekt und
          // können die Sperre nicht per Request-Burst umgehen.
          const failed = await memoryStore!.registerFailedAdminLogin(now, LOGIN_FAILURE_WINDOW_MS);
          if (failed >= LOGIN_MAX_FAILED_ATTEMPTS) {
            await memoryStore!.lockAdminAccount(now + LOGIN_LOCKOUT_MS);
            logger.warn('admin login locked after repeated failures');
          }
          return c.json({ error: 'Passwort falsch' }, 401);
        }
        await memoryStore!.resetAdminLoginFailures();
        const { token, tokenHash } = newSessionToken();
        await memoryStore!.createAdminSession(tokenHash, now + ADMIN_SESSION_TTL_MS);
        return c.json({ token });
      } catch (err) {
        logger.error('admin login failed', { name: err instanceof Error ? err.name : 'unknown' });
        return c.json({ error: 'Datenbank nicht erreichbar' }, 503);
      }
    },
  );

  // ---- Auth-Middleware für alle übrigen Admin-Endpunkte ----

  app.use('*', async (c, next) => {
    const header = c.req.header('authorization') ?? '';
    if (tokenMode && safeEqual(header, `Bearer ${config.adminToken}`)) {
      c.set('adminPrincipal', { role: 'initial', name: 'Admin-Token', provider: 'token' });
      await next();
      return;
    }
    const token = bearerToken(header);
    if (!token) {
      return c.json({ error: 'Nicht autorisiert' }, 401);
    }
    try {
      if (!tokenMode && await memoryStore!.hasAdminSession(hashSessionToken(token), Date.now())) {
        c.set('adminPrincipal', { role: 'initial', name: 'Admin-Konto', provider: 'admin' });
        await next();
        return;
      }
      const delegated = await resolveDelegatedAdmin(token);
      if (delegated === 'not_admin') {
        return c.json({ error: 'Dieses Konto hat keine Admin-Rolle', code: 'not_admin' }, 403);
      }
      if (delegated) {
        c.set('adminPrincipal', delegated);
        await next();
        return;
      }
    } catch (err) {
      if (err instanceof OidcError) {
        logger.error('admin oidc verification unavailable', { name: err.name });
        return c.json({ error: 'Identity-Provider nicht erreichbar' }, 503);
      }
      logger.error('admin session check failed', { name: err instanceof Error ? err.name : 'unknown' });
      return c.json({ error: 'Datenbank nicht erreichbar' }, 503);
    }
    return c.json({ error: 'Nicht autorisiert' }, 401);
  });

  /** Wer gerade angemeldet ist — die Seite blendet danach den Admin-Schalter ein/aus. */
  app.get('/me', (c) => c.json(c.get('adminPrincipal')));

  app.post('/logout', async (c) => {
    const token = bearerToken(c.req.header('authorization'));
    if (!tokenMode && token) {
      try {
        await memoryStore!.deleteAdminSession(hashSessionToken(token));
      } catch (err) {
        logger.warn('admin logout failed', { name: err instanceof Error ? err.name : 'unknown' });
      }
    }
    return c.json({ ok: true });
  });

  // Slash-Befehle und Statistik brauchen den Store — der Manifest-Download
  // (GET /trex) nicht, deshalb hängt der Check nicht in der Middleware oben.
  const storeGuard: MiddlewareHandler = async (c, next) => {
    if (!memoryStore) {
      return c.json(
        { error: 'User-Memory ist auf diesem Server nicht aktiviert — Admin-Daten brauchen einen Store' },
        503,
      );
    }
    await next();
  };
  app.use('/commands', storeGuard);
  app.use('/models', storeGuard);
  app.use('/metrics', storeGuard);
  app.use('/playbooks', storeGuard);
  app.use('/stats', storeGuard);
  app.route('/mcp', createMcpAdminRoute(mcpStore, {
    listDashboards: () => memoryStore!.listDashboards(),
    listUsers: () => memoryStore!.listUsers(),
  }, logger, async (feature) => hasFeature((await authState.get()).license, feature)));
  app.route('/tableau-server', createTableauAdminRoute(tableau, logger));
  app.route('/watch', createWatchAdminRoute({ store: watchStore, hasFeature: async (feature) => hasFeature((await authState.get()).license, feature), logger }));

  /**
   * Manifest-Download für Tableau: liefert das .trex mit der angegebenen
   * (validierten) HTTPS-Extension-URL — der Admin lädt es aus der Admin-UI
   * herunter und trägt es in Tableau bzw. die Server-Safelist ein.
   */
  app.get('/trex', (c) => {
    const validation = validateExtensionUrl(c.req.query('url') ?? '');
    if (!validation.ok || !validation.url) {
      return c.json({ error: validation.reason ?? 'Ungültige URL' }, 400);
    }
    logger.info('admin trex download', { url: validation.url });
    c.header('content-type', 'application/xml; charset=utf-8');
    c.header('content-disposition', 'attachment; filename="openvizpilot.trex"');
    c.header('cache-control', 'no-store');
    return c.body(buildTrexManifest({ url: validation.url }));
  });

  app.get('/commands', async (c) => {
    try {
      const stored = await memoryStore!.getSlashCommands();
      if (stored) return c.json({ commands: stored, source: 'custom' as const });
      return c.json({ commands: DEFAULT_SLASH_COMMANDS, source: 'default' as const });
    } catch (err) {
      logger.error('admin commands read failed', { name: err instanceof Error ? err.name : 'unknown' });
      return c.json({ error: 'Datenbank nicht erreichbar' }, 503);
    }
  });

  app.put(
    '/commands',
    zValidator('json', slashCommandListSchema, (result, c) => {
      if (!result.success) {
        return c.json({ error: 'Ungültige Befehlsliste', details: result.error.issues }, 400);
      }
      return undefined;
    }),
    async (c) => {
      const commands = c.req.valid('json');
      try {
        await memoryStore!.setSlashCommands(commands);
        logger.info('admin slash commands updated', { count: commands.length });
        return c.json({ ok: true });
      } catch (err) {
        logger.error('admin commands write failed', { name: err instanceof Error ? err.name : 'unknown' });
        return c.json({ error: 'Datenbank nicht erreichbar' }, 503);
      }
    },
  );

  app.delete('/commands', async (c) => {
    try {
      await memoryStore!.setSlashCommands(null);
      logger.info('admin slash commands reset to defaults');
      return c.json({ ok: true });
    } catch (err) {
      logger.error('admin commands reset failed', { name: err instanceof Error ? err.name : 'unknown' });
      return c.json({ error: 'Datenbank nicht erreichbar' }, 503);
    }
  });

  app.get('/models', async (c) => {
    try {
      const stored = await memoryStore!.getModelCatalog();
      if (stored) return c.json({ models: stored, source: 'custom' as const });
      return c.json({ models: [], source: 'default' as const });
    } catch (err) {
      logger.error('admin models read failed', { name: err instanceof Error ? err.name : 'unknown' });
      return c.json({ error: 'Datenbank nicht erreichbar' }, 503);
    }
  });

  app.put(
    '/models',
    zValidator('json', modelCatalogSchema, (result, c) => {
      if (!result.success) {
        return c.json({ error: 'Ungültiger Modell-Katalog', details: result.error.issues }, 400);
      }
      return undefined;
    }),
    async (c) => {
      const catalog = c.req.valid('json');
      try {
        await memoryStore!.setModelCatalog(catalog);
        logger.info('admin model catalog updated', { count: catalog.length });
        return c.json({ ok: true });
      } catch (err) {
        logger.error('admin models write failed', { name: err instanceof Error ? err.name : 'unknown' });
        return c.json({ error: 'Datenbank nicht erreichbar' }, 503);
      }
    },
  );

  app.delete('/models', async (c) => {
    try {
      await memoryStore!.setModelCatalog(null);
      logger.info('admin model catalog reset (upstream list applies)');
      return c.json({ ok: true });
    } catch (err) {
      logger.error('admin models reset failed', { name: err instanceof Error ? err.name : 'unknown' });
      return c.json({ error: 'Datenbank nicht erreichbar' }, 503);
    }
  });

  app.get('/metrics', async (c) => {
    try {
      const stored = await memoryStore!.getMetricCatalog();
      if (stored) return c.json({ metrics: stored, source: 'custom' as const });
      return c.json({ metrics: [], source: 'default' as const });
    } catch (err) {
      logger.error('admin metric catalog read failed', { name: err instanceof Error ? err.name : 'unknown' });
      return c.json({ error: 'Datenbank nicht erreichbar' }, 503);
    }
  });

  app.put(
    '/metrics',
    zValidator('json', metricCatalogSchema, (result, c) => {
      if (!result.success) {
        return c.json({ error: 'Ungültiger Kennzahlenkatalog', details: result.error.issues }, 400);
      }
      return undefined;
    }),
    async (c) => {
      const catalog = c.req.valid('json');
      try {
        await memoryStore!.setMetricCatalog(catalog);
        logger.info('admin metric catalog updated', { count: catalog.length });
        return c.json({ ok: true });
      } catch (err) {
        logger.error('admin metric catalog write failed', { name: err instanceof Error ? err.name : 'unknown' });
        return c.json({ error: 'Datenbank nicht erreichbar' }, 503);
      }
    },
  );

  app.delete('/metrics', async (c) => {
    try {
      await memoryStore!.setMetricCatalog(null);
      logger.info('admin metric catalog reset');
      return c.json({ ok: true });
    } catch (err) {
      logger.error('admin metric catalog reset failed', { name: err instanceof Error ? err.name : 'unknown' });
      return c.json({ error: 'Datenbank nicht erreichbar' }, 503);
    }
  });

  /**
   * Modell-Lookup für die Admin-UI: rohe, UNGEFILTERTE Liste des Endpunkts
   * (ohne OVP_MODEL_ALLOWLIST) — der Admin sieht alles, was der Endpunkt meldet,
   * und wählt daraus die Katalog-Einträge.
   */
  app.get('/upstream-models', async (c) => {
    try {
      const list = await client.models.list();
      const ids = list.data.map((m) => m.id).sort((a, b) => a.localeCompare(b));
      return c.json({ models: ids });
    } catch (err) {
      logger.warn('admin upstream models lookup failed', {
        name: err instanceof Error ? err.name : 'unknown',
      });
      return c.json({ error: 'LLM-Endpunkt nicht erreichbar' }, 502);
    }
  });

  // ---- Anmeldung, OIDC & Lizenz (Admin-UI überschreibt die Env-Defaults) ----

  const describeAuth = async () => {
    const state = await authState.get();
    const stored = memoryStore ? await memoryStore.getAuthSettings() : null;
    return {
      effective: {
        mode: state.mode,
        source: state.source,
        blockedReason: state.blockedReason,
        publicUrl: state.publicUrl,
        /** Exakt die Redirect-URI, die beim IdP registriert werden muss. */
        redirectUri: state.publicUrl ? `${state.publicUrl}/auth/callback` : null,
        license: describeLicense(state.license, state.lease),
        oidc: state.oidcSettings
          ? { provider: state.oidcSettings.provider, issuer: state.oidcSettings.issuer, clientId: state.oidcSettings.clientId, scopes: state.oidcSettings.scopes }
          : null,
      },
      // Gespeicherte Werte ohne Geheimnisse: Client-Secret und Lizenz-Token
      // nur als "vorhanden"-Flag.
      stored: stored
        ? {
            mode: stored.mode,
            oidc: stored.oidc ? { provider: stored.oidc.provider, issuer: stored.oidc.issuer, clientId: stored.oidc.clientId, scopes: stored.oidc.scopes } : null,
            hasClientSecret: Boolean(stored.oidc?.clientSecret),
            hasLicense: Boolean(stored.license),
            publicUrl: stored.publicUrl ?? null,
          }
        : null,
      // Transparenz: Der Heartbeat ist Teil der Enterprise-Lizenz, aber der
      // Betreiber muss jederzeit sehen können, was rausgeht und wie es lief.
      telemetry: await describeTelemetry({
        endpoint: config.telemetryEndpoint,
        license: async () => {
          const current = await authState.get();
          return { status: current.license, token: current.licenseToken };
        },
        store: telemetryStore,
      }),
      envDefaults: {
        mode: config.authMode,
        oidcProvider: config.oidc?.provider ?? null,
        hasLicense: Boolean(config.licenseEnv.OVP_LICENSE || config.licenseEnv.OVP_LICENSE_PATH),
        publicUrl: config.publicUrl,
      },
      featureLabels: EE_FEATURE_LABELS,
      storeAvailable: Boolean(memoryStore),
      /** Ob „Jetzt aktualisieren“ und die Offline-Aktivierung möglich sind (Datenbank vorhanden). */
      leaseAvailable: Boolean(telemetryStore),
    };
  };

  /**
   * Heartbeat sofort auslösen und den Zustand neu lesen — Aktivierung ohne 24 h
   * Wartezeit, sowie Grundlage für Stilllegen/Übertragen und die Installationsliste.
   * Wirft nie; ein Fehler bleibt eine Logzeile, der Zustand zeigt ihn.
   */
  const runHeartbeat = async (options: { action?: HeartbeatAction; onResponse?: (info: HeartbeatResponseInfo) => void; reactivate?: boolean } = {}): Promise<'sent' | 'skipped' | 'failed'> => {
    if (!refreshLease) return 'skipped';
    let result: 'sent' | 'skipped' | 'failed' = 'skipped';
    try {
      result = await refreshLease(options);
    } catch (err) {
      logger.warn('license heartbeat action failed', { name: err instanceof Error ? err.name : 'unknown' });
      result = 'failed';
    }
    authState.invalidate();
    return result;
  };

  /** Ausdrückliche Aktivierung (neuer Schlüssel, „Jetzt aktualisieren“) — darf eine stillgelegte Installation reaktivieren. */
  const activateNow = async (): Promise<void> => {
    await runHeartbeat({ reactivate: true });
  };

  /** Lizenz- und Anmeldestatus (nur Metadaten, nie Token/Secrets). */
  app.get('/auth-settings', async (c) => {
    try {
      return c.json(await describeAuth());
    } catch (err) {
      logger.error('auth settings read failed', { name: err instanceof Error ? err.name : 'unknown' });
      return c.json({ error: 'Einstellungen nicht lesbar' }, 500);
    }
  });

  const authSettingsInput = authSettingsSchema.extend({
    oidc: authSettingsSchema.shape.oidc.unwrap().extend({ clientSecret: z.string().max(500).optional() }).optional(),
    /** '' = Lizenz entfernen, undefined = unverändert lassen. */
    license: z.string().max(8000).optional(),
    /** '' = auf OVP_PUBLIC_URL (Env) zurückfallen. */
    publicUrl: z.union([z.literal(''), z.string().url().max(500)]).optional(),
  });

  /**
   * Speichert Modus/OIDC/Lizenz. Prüft VOR dem Speichern, dass der gewünschte
   * Modus betriebsbereit ist (sonst würde die API fail-closed dichtmachen):
   * 'oidc' braucht eine gültige SSO-Lizenz und Issuer/Client-ID. Ein leeres
   * Client-Secret behält das gespeicherte, eine leere Lizenz entfernt sie.
   */
  app.put('/auth-settings', zValidator('json', authSettingsInput, (result, c) => {
      if (!result.success) return c.json({ error: 'Ungültige Anmelde-Einstellungen', details: result.error.issues }, 400);
    }), async (c) => {
    if (!memoryStore) return c.json({ error: 'Einstellungen benötigen einen Memory-Store' }, 503);
    const input = c.req.valid('json');
    try {
      const stored = await memoryStore.getAuthSettings();
      const licenseToken = input.license === undefined ? stored?.license : input.license.trim() || undefined;
      let license: LicenseStatus;
      if (licenseToken) {
        license = verifyLicense(licenseToken, config.licenseTrustedKeys);
        if (license.status === 'invalid') return c.json({ error: `Lizenz ungültig: ${license.reason}` }, 400);
      } else {
        license = { status: 'none' };
      }
      const oidc = input.oidc
        ? { ...input.oidc, clientSecret: input.oidc.clientSecret?.trim() || stored?.oidc?.clientSecret || undefined }
        : stored?.oidc;
      const publicUrl = input.publicUrl === undefined ? stored?.publicUrl : input.publicUrl.trim().replace(/\/$/, '') || undefined;
      if (input.mode === 'oidc') {
        // Ohne DB-Lizenz zählt die Env-Lizenz (Helm-Secret) — der effektive
        // Zustand entscheidet, nicht nur das Formular.
        const effectiveLicense = licenseToken ? license : loadLicenseFromEnv(config.licenseEnv, { trustedKeys: config.licenseTrustedKeys });
        if (!hasFeature(effectiveLicense, 'sso')) {
          return c.json({ error: 'Single Sign-On braucht eine gültige Enterprise-Lizenz mit Feature „sso“ — bitte zuerst den Lizenzschlüssel eintragen.' }, 400);
        }
        if (!oidc && !config.oidc) return c.json({ error: 'Single Sign-On braucht Issuer und Client-ID.' }, 400);
        if (!publicUrl && !config.publicUrl) {
          return c.json({ error: 'Single Sign-On braucht die öffentliche URL der Middleware (z. B. https://chat.example.com) für die Redirect-URI.' }, 400);
        }
      }
      if (input.mode === 'local') {
        // Sonst sperrt der Admin alle Anwender aus, ohne es zu merken.
        const users = await memoryStore.listUsers();
        if (!users.some((u) => !u.disabled)) {
          return c.json({ error: 'Der Modus „Benutzerkonten“ braucht mindestens ein aktives Benutzerkonto — bitte zuerst unten einen Benutzer anlegen.' }, 400);
        }
      }
      const next: AuthSettings = {
        mode: input.mode,
        ...(oidc ? { oidc } : {}),
        ...(licenseToken ? { license: licenseToken } : {}),
        ...(publicUrl ? { publicUrl } : {}),
      };
      await memoryStore.setAuthSettings(next);
      authState.invalidate();
      logger.info('auth settings updated', { mode: next.mode, provider: next.oidc?.provider ?? null, license: license.status });
      // Neuer Lizenzschlüssel: sofort aktivieren statt auf den nächsten Tages-Heartbeat zu warten.
      if (input.license?.trim() && input.license.trim() !== stored?.license) await activateNow();
      return c.json(await describeAuth());
    } catch (err) {
      logger.error('auth settings write failed', { name: err instanceof Error ? err.name : 'unknown' });
      return c.json({ error: 'Einstellungen konnten nicht gespeichert werden' }, 500);
    }
  });

  /** Zurück auf die Env-Defaults (löscht die DB-Einstellungen). */
  app.delete('/auth-settings', async (c) => {
    if (!memoryStore) return c.json({ error: 'Einstellungen benötigen einen Memory-Store' }, 503);
    await memoryStore.setAuthSettings(null);
    authState.invalidate();
    return c.json(await describeAuth());
  });

  // ---- Lizenzaktivierung (Lease) ----

  /** „Jetzt aktualisieren“: Heartbeat sofort, Antwort = neuer Stand. */
  app.post('/license/refresh', async (c) => {
    if (!refreshLease) return c.json({ error: 'Aktivierung benötigt eine Datenbank' }, 503);
    try {
      await activateNow();
      return c.json(await describeAuth());
    } catch (err) {
      logger.error('license refresh failed', { name: err instanceof Error ? err.name : 'unknown' });
      return c.json({ error: 'Aktualisierung fehlgeschlagen' }, 500);
    }
  });

  /** Offline-Aktivierung, Schritt 1: Anfrage für den WerkWorks-Lizenzgenerator (Download). */
  app.get('/license/activation-request', async (c) => {
    if (!telemetryStore) return c.json({ error: 'Aktivierung benötigt eine Datenbank' }, 503);
    const state = await authState.get();
    if (state.verifiedLicense.status !== 'valid') return c.json({ error: 'Offline-Aktivierung braucht eine gültige Lizenz.' }, 400);
    try {
      const request = {
        product: 'openvizpilot',
        installationId: await telemetryStore.getInstallationId(),
        licenseId: state.verifiedLicense.license.licenseId,
        version: config.appVersion,
        environment: config.environment,
        requestedAt: new Date().toISOString(),
      };
      c.header('Content-Disposition', 'attachment; filename="ovp-activation-request.json"');
      return c.json(request);
    } catch (err) {
      logger.error('activation request failed', { name: err instanceof Error ? err.name : 'unknown' });
      return c.json({ error: 'Aktivierungsanfrage konnte nicht erstellt werden' }, 500);
    }
  });

  /** Offline-Aktivierung, Schritt 2: signierte Lease einfügen — muss zu Installation und Lizenz passen. */
  app.put('/license/lease', zValidator('json', z.object({ lease: z.string().min(1).max(8000) }), (result, c) => {
      if (!result.success) return c.json({ error: 'Ungültige Lease', details: result.error.issues }, 400);
    }), async (c) => {
    if (!telemetryStore) return c.json({ error: 'Aktivierung benötigt eine Datenbank' }, 503);
    const state = await authState.get();
    if (state.verifiedLicense.status !== 'valid') return c.json({ error: 'Offline-Aktivierung braucht eine gültige Lizenz.' }, 400);
    try {
      const token = c.req.valid('json').lease.trim();
      const check = verifyLease(token, {
        installationId: await telemetryStore.getInstallationId(),
        licenseId: state.verifiedLicense.license.licenseId,
        keys: config.leaseTrustedKeys,
      });
      if (check.status === 'invalid') return c.json({ error: `Lease ungültig: ${check.reason}` }, 400);
      if (check.status === 'expired') return c.json({ error: `Lease ist am ${check.lease.leaseUntil.slice(0, 10)} abgelaufen.` }, 400);
      await telemetryStore.saveLease(token);
      authState.invalidate();
      logger.info('license lease stored', { offline: Boolean(check.lease.offline), leaseUntil: check.lease.leaseUntil });
      return c.json(await describeAuth());
    } catch (err) {
      logger.error('license lease write failed', { name: err instanceof Error ? err.name : 'unknown' });
      return c.json({ error: 'Lease konnte nicht gespeichert werden' }, 500);
    }
  });

  /**
   * Installationen dieser Lizenz — nur zur Anzeige, aus der Antwort DIESES
   * Heartbeats, nie gespeichert. Lesen ist allen Admins erlaubt (initial und
   * delegiert), anders als Stilllegen/Übertragen unten.
   */
  app.get('/license/installations', async (c) => {
    if (!refreshLease || !telemetryStore) return c.json({ error: 'Benötigt eine Datenbank' }, 503);
    let installations: HeartbeatInstallation[] = [];
    await runHeartbeat({ onResponse: (info) => { installations = info.installations ?? []; } });
    return c.json({ installations });
  });

  /** Stilllegen der eigenen Installation — Platz wird beim nächsten Heartbeat frei. Nur der initiale Admin. */
  app.post('/license/deactivate', zValidator('json', z.object({ confirm: z.literal(true) }).strict(), (result, c) => {
      if (!result.success) return c.json({ error: 'Bestätigung erforderlich' }, 400);
    }), async (c) => {
    if (c.get('adminPrincipal').role !== 'initial') {
      return c.json({ error: 'Stilllegen ist nur dem initialen Admin (Token bzw. Admin-Konto) vorbehalten', code: 'initial_admin_required' }, 403);
    }
    if (!refreshLease || !telemetryStore) return c.json({ error: 'Stilllegen benötigt eine Datenbank' }, 503);
    const result = await runHeartbeat({ action: 'deactivate' });
    if (result !== 'sent') return c.json({ error: 'Stilllegen fehlgeschlagen — Gegenstelle nicht erreichbar' }, 502);
    logger.info('license installation deactivated by admin');
    return c.json(await describeAuth());
  });

  /** Übernehmen: eine andere Installation derselben Lizenz stilllegen und die eigene aktivieren. Nur der initiale Admin. */
  app.post('/license/transfer', zValidator('json', z.object({ installationId: z.string().min(1).max(200) }).strict(), (result, c) => {
      if (!result.success) return c.json({ error: 'Ungültige Installation-ID' }, 400);
    }), async (c) => {
    if (c.get('adminPrincipal').role !== 'initial') {
      return c.json({ error: 'Übertragen ist nur dem initialen Admin (Token bzw. Admin-Konto) vorbehalten', code: 'initial_admin_required' }, 403);
    }
    if (!refreshLease || !telemetryStore) return c.json({ error: 'Übertragen benötigt eine Datenbank' }, 503);
    const { installationId } = c.req.valid('json');
    let errorCode: string | undefined;
    const result = await runHeartbeat({ action: { transfer: installationId }, onResponse: (info) => { errorCode = info.error; } });
    if (result !== 'sent') {
      const unknown = errorCode === 'unknown_installation';
      return c.json({ error: unknown ? 'Installation nicht gefunden — sie gehört nicht zu dieser Lizenz.' : 'Übertragen fehlgeschlagen — Gegenstelle nicht erreichbar' }, unknown ? 400 : 502);
    }
    logger.info('license installation transferred', { installationId });
    return c.json(await describeAuth());
  });

  app.get('/user-access', async (c) => {
    if (!memoryStore) return c.json({ users: [], storeAvailable: false });
    try {
      return c.json({ users: await memoryStore.listUserAccess(), storeAvailable: true });
    } catch {
      return c.json({ error: 'Freigaben nicht lesbar' }, 503);
    }
  });

  app.put('/user-access/:id', zValidator('json', z.object({ ai: z.boolean(), tableauApi: z.boolean(), serverData: z.boolean().optional(), admin: z.boolean().optional() }).strict(), (result, c) => {
    if (!result.success) return c.json({ error: 'Ungültige Freigaben' }, 400);
  }), async (c) => {
    if (!memoryStore) return c.json({ error: 'Freigaben benötigen einen Memory-Store' }, 503);
    const id = c.req.param('id');
    if (!/^[a-f0-9]{64}$/.test(id)) return c.json({ error: 'Ungültige Benutzer-ID' }, 400);
    try {
      const { admin, ...grants } = c.req.valid('json');
      const initial = c.get('adminPrincipal').role === 'initial';
      if (admin !== undefined && !initial) {
        // Delegierte Admins dürfen die Rolle weder vergeben noch entziehen —
        // ein unverändert mitgesendetes `admin` ist in Ordnung.
        const current = await memoryStore.getUserAccess(id);
        if (!current) return c.json({ error: 'Benutzer nicht gefunden' }, 404);
        if (current.admin !== admin) {
          return c.json({ error: 'Die Admin-Rolle kann nur der initiale Admin (Token bzw. Admin-Konto) vergeben', code: 'initial_admin_required' }, 403);
        }
      }
      const update = initial && admin !== undefined ? { ...grants, admin } : grants;
      if (!await memoryStore.setUserAccess(id, update)) return c.json({ error: 'Benutzer nicht gefunden' }, 404);
      logger.info('user access updated', { id, ...update });
      return c.json({ ok: true });
    } catch {
      return c.json({ error: 'Freigaben konnten nicht gespeichert werden' }, 503);
    }
  });

  // ---- Benutzerkonten (Open Core, Modus 'local') ----

  app.get('/users', async (c) => {
    if (!memoryStore) return c.json({ users: [], storeAvailable: false });
    try {
      return c.json({ users: await memoryStore.listUsers(), storeAvailable: true, minPasswordChars: MIN_USER_PASSWORD_CHARS });
    } catch (err) {
      logger.error('users read failed', { name: err instanceof Error ? err.name : 'unknown' });
      return c.json({ error: 'Benutzer nicht lesbar' }, 500);
    }
  });

  app.post('/users', zValidator('json', createUserSchema, (result, c) => {
      if (!result.success) return c.json({ error: 'Ungültige Benutzerdaten', details: result.error.issues }, 400);
    }), async (c) => {
    if (!memoryStore) return c.json({ error: 'Benutzerkonten benötigen einen Memory-Store' }, 503);
    const { username, displayName, password } = c.req.valid('json');
    try {
      const created = await memoryStore.createUser(username, displayName?.trim() ?? '', await hashPassword(password));
      if (!created) return c.json({ error: 'Benutzername ist schon vergeben' }, 409);
      logger.info('user created');
      return c.json({ ok: true }, 201);
    } catch (err) {
      logger.error('user create failed', { name: err instanceof Error ? err.name : 'unknown' });
      return c.json({ error: 'Benutzer konnte nicht angelegt werden' }, 500);
    }
  });

  const usernameParam = (raw: string): string | null => (USERNAME_PATTERN.test(raw) ? raw : null);

  app.put('/users/:username/password', zValidator('json', setPasswordSchema, (result, c) => {
      if (!result.success) return c.json({ error: 'Ungültiges Passwort', details: result.error.issues }, 400);
    }), async (c) => {
    if (!memoryStore) return c.json({ error: 'Benutzerkonten benötigen einen Memory-Store' }, 503);
    const username = usernameParam(c.req.param('username'));
    if (!username) return c.json({ error: 'Ungültiger Benutzername' }, 400);
    const ok = await memoryStore.setUserPassword(username, await hashPassword(c.req.valid('json').password));
    if (!ok) return c.json({ error: 'Benutzer nicht gefunden' }, 404);
    await memoryStore.resetUserLoginFailures(username);
    await memoryStore.deleteUserSessions(username); // alte Sitzungen sofort ungültig
    return c.json({ ok: true });
  });

  app.put('/users/:username/disabled', zValidator('json', z.object({ disabled: z.boolean() }), (result, c) => {
      if (!result.success) return c.json({ error: 'Ungültiger Request', details: result.error.issues }, 400);
    }), async (c) => {
    if (!memoryStore) return c.json({ error: 'Benutzerkonten benötigen einen Memory-Store' }, 503);
    const username = usernameParam(c.req.param('username'));
    if (!username) return c.json({ error: 'Ungültiger Benutzername' }, 400);
    const { disabled } = c.req.valid('json');
    const ok = await memoryStore.setUserDisabled(username, disabled);
    if (!ok) return c.json({ error: 'Benutzer nicht gefunden' }, 404);
    if (disabled) await memoryStore.deleteUserSessions(username);
    return c.json({ ok: true });
  });

  app.delete('/users/:username', async (c) => {
    if (!memoryStore) return c.json({ error: 'Benutzerkonten benötigen einen Memory-Store' }, 503);
    const username = usernameParam(c.req.param('username'));
    if (!username) return c.json({ error: 'Ungültiger Benutzername' }, 400);
    const ok = await memoryStore.deleteUser(username);
    if (!ok) return c.json({ error: 'Benutzer nicht gefunden' }, 404);
    logger.info('user deleted');
    return c.json({ ok: true });
  });

  app.get('/playbooks', async (c) => {
    try {
      const [playbooks, dashboards] = await Promise.all([memoryStore!.listPlaybooks(), memoryStore!.listDashboards()]);
      return c.json({ playbooks, dashboards });
    } catch (err) {
      logger.error('admin playbooks read failed', { name: err instanceof Error ? err.name : 'unknown' });
      return c.json({ error: 'Datenbank nicht erreichbar' }, 503);
    }
  });

  app.put(
    '/playbooks',
    zValidator('json', playbookEntrySchema, (result, c) => {
      if (!result.success) {
        return c.json({ error: 'Ungültiges Playbook', details: result.error.issues }, 400);
      }
      return undefined;
    }),
    async (c) => {
      const { dashboardKey, playbook } = c.req.valid('json');
      try {
        await memoryStore!.setPlaybook(dashboardKey, playbook);
        logger.info('admin playbook updated', {
          starters: playbook.starters.length,
          commands: playbook.commands.length,
        });
        return c.json({ ok: true });
      } catch (err) {
        logger.error('admin playbook write failed', { name: err instanceof Error ? err.name : 'unknown' });
        return c.json({ error: 'Datenbank nicht erreichbar' }, 503);
      }
    },
  );

  app.delete('/playbooks', async (c) => {
    const dashboardKey = c.req.query('dashboardKey')?.trim();
    if (!dashboardKey) return c.json({ error: 'dashboardKey fehlt' }, 400);
    try {
      await memoryStore!.setPlaybook(dashboardKey, null);
      logger.info('admin playbook deleted');
      return c.json({ ok: true });
    } catch (err) {
      logger.error('admin playbook delete failed', { name: err instanceof Error ? err.name : 'unknown' });
      return c.json({ error: 'Datenbank nicht erreichbar' }, 503);
    }
  });

  app.get('/stats', async (c) => {
    const days = clampDays(c.req.query('days'));
    try {
      const rows = await memoryStore!.getUsageStats(days);
      const dashboards = aggregateDashboardUsage(await memoryStore!.getDashboardUsage(days));
      return c.json({ rows, dashboards });
    } catch (err) {
      logger.error('admin stats read failed', { name: err instanceof Error ? err.name : 'unknown' });
      return c.json({ error: 'Datenbank nicht erreichbar' }, 503);
    }
  });

  return app;
}
