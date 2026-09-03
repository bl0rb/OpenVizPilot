import { serveStatic } from '@hono/node-server/serve-static';
import {
  createAuthCallbackRoute,
  createPersonalizationRoutes,
  describeLicense,
  EE_FEATURES,
  hasFeature,
  requireOidcUser,
  type AuthVariables,
  type EeFeature,
} from '@openvizpilot/ee/server';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { adminPageHtml } from './admin-page';
import { createAuthStateProvider, type AuthStateProvider } from './auth-state';
import type { AppConfig } from './env';
import { createLLMClient } from './llm/client';
import { createLogger, type Logger } from './logger';
import { createMemoryStore, type MemoryStore } from './memory/store';
import { createAdminRoute } from './routes/admin';
import { createAuthRoutes, requireLocalUser } from './routes/auth';
import { createChatRoute } from './routes/chat';
import { createCommandsRoute } from './routes/commands';
import { createHealthRoute } from './routes/health';
import { createModelsRoute } from './routes/models';
import { createStatsRoute } from './routes/stats';

const MAX_BODY_BYTES = 1024 * 1024;

export function createApp(config: AppConfig): {
  app: Hono<AuthVariables>;
  logger: Logger;
  memoryStore: MemoryStore | null;
  authState: AuthStateProvider;
} {
  const logger = createLogger(config.logLevel);
  const client = createLLMClient(config);
  const backend = createMemoryStore(config, logger);
  const memoryStore = backend?.store ?? null;
  // Speicher der Enterprise-Personalisierung (ee/) auf derselben Verbindung.
  const personalizationStore = backend?.personalization ?? null;
  if (memoryStore) {
    logger.info('User-Memory aktiv', {
      backend: config.memoryDatabaseUrl ? 'postgres' : 'sqlite',
      model: config.memoryModel,
    });
  }

  // Anmelde-Zustand (Modus, OIDC-Client, Enterprise-Lizenz) — Env-Defaults,
  // zur Laufzeit aus der Admin-UI überschreibbar (auth-state.ts).
  const authState = createAuthStateProvider(config, memoryStore, logger);
  void authState.get().then((state) => {
    if (state.license.status !== 'none') logger.info('Enterprise-Lizenz', describeLicense(state.license));
    logger.info('Anmeldung', { mode: state.mode, source: state.source, ...(state.blockedReason ? { blocked: state.blockedReason } : {}) });
  });
  const authLog = (level: 'info' | 'warn' | 'error', msg: string, data?: Record<string, unknown>) =>
    logger[level](msg, data);
  /** Lizenzprüfung pro Request — ein in der Admin-UI eingetragener Schlüssel wirkt sofort. */
  const licensedFeature = async (feature: EeFeature): Promise<boolean> => hasFeature((await authState.get()).license, feature);

  const app = new Hono<AuthVariables>();

  app.use(
    '*',
    bodyLimit({
      maxSize: MAX_BODY_BYTES,
      onError: (c) => c.json({ error: 'Request zu groß' }, 413),
    }),
  );

  // Security-Header für ausgelieferte Seiten (Prod-Serving der Extension).
  // img-src ohne externe Hosts blockiert Bild-Beacons als Exfiltrationskanal;
  // KEIN frame-ancestors/X-Frame-Options — die Extension läuft im Tableau-iframe.
  app.use('*', async (c, next) => {
    await next();
    if (c.req.path.startsWith('/api/')) return;
    if (c.req.path === '/admin' || c.req.path === '/auth/callback') {
      // Admin-UI: eigenständige Seite (läuft NICHT im Tableau-iframe), daher
      // zusätzlich frame-ancestors 'none'. Das Template ist ein einziger
      // Template-String mit Inline-<style>/<script> (kein Build-Schritt) —
      // dafür braucht es 'unsafe-inline'.
      c.res.headers.set(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
      );
      c.res.headers.set('X-Frame-Options', 'DENY');
    } else {
      c.res.headers.set(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' https:; object-src 'none'; base-uri 'self'",
      );
    }
    c.res.headers.set('X-Content-Type-Options', 'nosniff');
    c.res.headers.set('Referrer-Policy', 'no-referrer');
  });

  // Dev (Vite-Proxy) und Prod (Same-Origin-Serving) brauchen kein CORS.
  // ALLOWED_ORIGINS ist der Escape Hatch für getrenntes Hosting.
  if (config.allowedOrigins.length > 0) {
    app.use('/api/*', cors({ origin: config.allowedOrigins }));
  }

  // Zugriffsschutz für /api/* — Modus zur Laufzeit aus authState:
  // - token: Shared-Token gegen Missbrauch als offener LLM-Proxy (API_AUTH_TOKEN)
  // - local: Open Core — Benutzerkonten aus der Admin-UI, Sitzungs-Token (DB);
  //          `authUser` = Benutzername
  // - oidc:  Enterprise — jeder Request trägt ein verifiziertes ID-Token des
  //          IdP; `authUser` = sub. Ohne gültige SSO-Lizenz/Konfiguration
  //          bleibt die API GESCHLOSSEN (503 mit Begründung), nie offen.
  // - none:  Zugriff MUSS auf Netzwerkebene beschränkt werden (docs/admin-deployment.md).
  // In allen Modi ersetzt `authUser` die client-asserted Tableau-ID (Memory,
  // Präferenzen, Statistik). AUSGENOMMEN: /api/admin/* (eigenes Admin-Regime)
  // und /api/auth/* (Login-Handshake).
  const isExempt = (path: string) => path.startsWith('/api/admin/') || path.startsWith('/api/auth/');
  const tokenExpected = config.apiAuthToken ? `Bearer ${config.apiAuthToken}` : null;
  app.use('/api/*', async (c, next) => {
    if (isExempt(c.req.path)) {
      await next();
      return;
    }
    const state = await authState.get();
    if (state.blockedReason) {
      return c.json({ error: state.blockedReason, code: 'auth_unavailable' }, 503);
    }
    switch (state.mode) {
      case 'none':
        await next();
        return;
      case 'token':
        if (!tokenExpected || c.req.header('authorization') !== tokenExpected) {
          return c.json({ error: 'Nicht autorisiert' }, 401);
        }
        await next();
        return;
      case 'local':
        if (!memoryStore) return c.json({ error: 'Passwort-Anmeldung benötigt einen Memory-Store' }, 503);
        return requireLocalUser(memoryStore)(c, next);
      case 'oidc':
        if (!state.oidc) return c.json({ error: 'Single Sign-On nicht verfügbar', code: 'auth_unavailable' }, 503);
        return requireOidcUser(state.oidc, authLog)(c, next);
    }
  });

  app.route('/api/auth', createAuthRoutes({ authState, store: memoryStore, logger }));
  app.route('/auth/callback', createAuthCallbackRoute());

  // Sitzungs-Check der Extension beim Start: läuft durch den Guard oben, liefert
  // also 401, wenn das gespeicherte Token (nach Moduswechsel, Ablauf, Sperre)
  // nicht mehr gilt — die Extension zeigt dann sofort das Login-Gate.
  app.get('/api/session', (c) => c.json({ user: c.get('authUser') ?? null }));

  // Welche Enterprise-Funktionen die Lizenz gerade freischaltet — die Extension
  // blendet danach Memory- und Abfragen-Bereiche ein oder aus, statt sie
  // anzubieten und beim Speichern zu scheitern.
  app.get('/api/features', async (c) => {
    const { license } = await authState.get();
    return c.json({
      features: Object.fromEntries(EE_FEATURES.map((feature) => [feature, hasFeature(license, feature)])),
    });
  });

  app.route('/healthz', createHealthRoute());
  app.route('/api/models', createModelsRoute(config, logger, client, memoryStore));
  app.route('/api/chat', createChatRoute(config, logger, client, memoryStore, personalizationStore, licensedFeature));
  // Personalisierung (User-Memory, eigene Abfragen) liegt in ee/ und ist
  // lizenzpflichtig — der Pfad bleibt /api/memory, damit ältere Extensions
  // weiter funktionieren.
  app.route('/api/memory', createPersonalizationRoutes({ store: personalizationStore, logger, hasFeature: licensedFeature }));
  app.route('/api/commands', createCommandsRoute(memoryStore, logger));
  app.route('/api/stats', createStatsRoute(memoryStore, logger));
  app.route('/api/admin', createAdminRoute(config, memoryStore, logger, client, authState));

  // Admin-UI: erreichbar mit statischem ADMIN_TOKEN ODER — für den
  // Passwort-Modus mit Ersteinrichtung — sobald ein Memory-Store existiert
  // (routes/admin.ts). Ohne beides: 404 wie jede unbekannte Route.
  if (config.adminToken || memoryStore) {
    app.get('/admin', (c) => c.html(adminPageHtml));
  }

  if (config.serveStaticDir) {
    app.use('*', serveStatic({ root: config.serveStaticDir }));
  }

  return { app, logger, memoryStore, authState };
}
