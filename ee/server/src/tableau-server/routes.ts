import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { AuthVariables } from '../auth-routes';
import type { PersonalizationLogger } from '../personalization';
import { resolveTableauSecret, tableauConfigInputSchema, TABLEAU_MIN_SERVER_VERSION, TABLEAU_REST_API_VERSION } from './config';
import { easIssuerUrl, generateEasKey } from './eas';
import { TableauService, TableauServiceError } from './service';
import { TableauError } from './errors';
import { tableauSearchSchema } from './schema';
import { tableauMetadataSearchSchema, tableauMetadataFieldSchema } from './metadata-schema';

const revisionSchema = z.object({ expectedRevision: z.string().uuid().nullable() }).strict();

/** Injectable wie `oidc.ts`s `FetchLike` — der Selbsttest in `/check` braucht in Tests keinen echten Netzwerkzugriff. */
type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

function isHttpsUrl(value: string | null): value is string {
  return typeof value === 'string' && value.startsWith('https://');
}

export function createTableauAdminRoute(
  service: TableauService | null,
  logger: PersonalizationLogger,
  fetchImpl: FetchLike = (input, init) => fetch(input, init),
): Hono {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.header('cache-control', 'no-store');
    if (!service) return c.json({ error: 'Tableau-Konfiguration benötigt eine Datenbank.' }, 503);
    await next();
  });
  app.onError(() => new Response(JSON.stringify({ error: 'Tableau-Konfiguration nicht verfügbar.' }), {
    status: 503, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  }));
  const view = async () => {
    const state = await service!.store.get();
    const access = await service!.access();
    let secretConfigured = false;
    if (state.config) {
      try { secretConfigured = Boolean(resolveTableauSecret(state.config)); } catch { /* Presence only. */ }
    }
    // `eas` spiegelt nur öffentliche Angaben (Issuer-/JWKS-URL, kid) — nie `privateKeyPem`.
    let eas: { issuerUrl: string; jwksUrl: string; kid: string; publicUrlOk: boolean } | null = null;
    const easKey = await service!.store.getEasKey();
    if (easKey) {
      const publicUrlOk = isHttpsUrl(access.publicUrl);
      let issuerUrl = '';
      try { issuerUrl = access.publicUrl ? easIssuerUrl(access.publicUrl) : ''; } catch { issuerUrl = ''; }
      eas = { issuerUrl, jwksUrl: issuerUrl ? `${issuerUrl}/jwks.json` : '', kid: easKey.kid, publicUrlOk };
    }
    return { ...state, secretConfigured, licensed: access.licensed, oidcReady: access.oidcReady, eas };
  };
  app.get('/', async (c) => c.json(await view()));
  app.put('/', async (c) => {
    const parsed = revisionSchema.extend({ config: tableauConfigInputSchema }).safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Ungültige Tableau-Konfiguration.', code: 'invalid_config' }, 400);
    const { config, expectedRevision } = parsed.data;
    if (config.enabled) {
      const access = await service!.access();
      if (!access.licensed) return c.json({ error: 'Enterprise-Freigabe tableauServer und sso erforderlich.', code: 'license_required' }, 402);
      if (!access.oidcReady) return c.json({ error: 'OIDC-Anmeldung muss eingerichtet sein.', code: 'oidc_required' }, 403);
      if (config.authMode === 'oauth2-trust') {
        if (!isHttpsUrl(access.publicUrl)) {
          return c.json({ error: 'OAuth 2.0 Trust benötigt eine HTTPS-Public-URL, sonst kann Tableau die Issuer-URL nicht erreichen.', code: 'public_url_required' }, 400);
        }
      } else {
        try { resolveTableauSecret(config); }
        catch { return c.json({ error: 'Secret-Referenz nicht verfügbar.', code: 'secret_unavailable' }, 400); }
      }
    }
    // Der EAS-Schlüssel entsteht beim ersten Speichern mit oauth2-trust — auch im deaktivierten
    // Entwurf, damit die Issuer-URL schon vor der Aktivierung in Tableau eingetragen werden kann.
    if (config.authMode === 'oauth2-trust' && !(await service!.store.getEasKey())) {
      await service!.store.saveEasKey(generateEasKey());
    }
    if (!(await service!.store.set(config, expectedRevision))) return c.json({ error: 'Konfiguration wurde geändert. Bitte neu laden.' }, 409);
    await service!.invalidate();
    logger.info('tableau configuration updated', { requestId: randomUUID(), actor: 'admin', operation: 'configure', enabled: config.enabled });
    return c.json(await view());
  });
  app.delete('/', async (c) => {
    const parsed = revisionSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Konfigurationsrevision erforderlich.' }, 400);
    if (!(await service!.store.set(null, parsed.data.expectedRevision))) return c.json({ error: 'Konfiguration wurde geändert. Bitte neu laden.' }, 409);
    await service!.invalidate();
    logger.info('tableau configuration reset', { requestId: randomUUID(), actor: 'admin', operation: 'reset' });
    return c.json(await view());
  });
  app.post('/check', async (c) => {
    const state = await view();
    if (!state.licensed) return c.json({ error: 'Enterprise-Freigabe tableauServer und sso erforderlich.' }, 402);
    if (!state.oidcReady) return c.json({ error: 'OIDC-Anmeldung muss eingerichtet sein.' }, 403);
    if (!state.config?.enabled) return c.json({ error: 'Aktive Konfiguration erforderlich.' }, 400);
    if (state.config.authMode === 'oauth2-trust') {
      if (!state.eas) return c.json({ error: 'EAS-Schlüssel fehlt. Konfiguration erneut speichern.', code: 'eas_key_missing' }, 400);
      if (!state.eas.publicUrlOk) return c.json({ error: 'OAuth 2.0 Trust benötigt eine HTTPS-Public-URL.', code: 'public_url_required' }, 400);
      if (!state.config.siteId) return c.json({ error: 'Site-ID (Site-LUID aus Tableau) erforderlich.', code: 'site_id_required' }, 400);
      try {
        const response = await fetchImpl(`${state.eas.issuerUrl}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(5_000) });
        if (!response.ok) throw new Error('discovery document not reachable');
      } catch {
        return c.json({
          error: 'Discovery-URL ist aus Sicht der Middleware selbst nicht erreichbar. Das beweist nicht, dass Tableau sie erreichen kann — Netzwerk/DNS/Zertifikat prüfen.',
          code: 'eas_discovery_unreachable',
        }, 400);
      }
      logger.info('tableau configuration check', { requestId: randomUUID(), actor: 'admin', operation: 'configuration_check', result: 'ok', authMode: 'oauth2-trust' });
      return c.json({ ok: true, stage: 'configuration', note: 'Erreichbarkeit nur aus Sicht der Middleware geprüft, nicht aus Sicht von Tableau.' });
    }
    if (!state.secretConfigured) return c.json({ error: 'Aktive Konfiguration mit Secret-Referenz erforderlich.' }, 400);
    logger.info('tableau configuration check', { requestId: randomUUID(), actor: 'admin', operation: 'configuration_check', result: 'ok' });
    return c.json({ ok: true, stage: 'configuration' });
  });
  return app;
}

export function createTableauRoute(service: TableauService | null): Hono<AuthVariables> {
  const app = new Hono<AuthVariables>();
  app.use('*', async (c, next) => {
    c.header('cache-control', 'no-store');
    if (!service) return c.json({ error: 'Tableau-Integration nicht verfügbar.' }, 503);
    const user = c.get('oidcUser');
    if (!user) return c.json({ error: 'Persönliche OIDC-Anmeldung erforderlich.', code: 'oidc_required' }, 403);
    await next();
  });
  app.onError((error, c) => {
      if (error instanceof TableauServiceError) {
        const status = error.code === 'tableau_busy' ? 429 : error.code === 'license_required' ? 402 : error.code === 'oidc_required' ? 403 : 503;
        if (status === 429) c.header('retry-after', '1');
        return c.json({ error: 'Tableau-Integration derzeit nicht verfügbar.', code: error.code }, status);
      }
      if (error instanceof TableauError) {
        const message = error.code === 'TABLEAU_CLAIM_INVALID'
          ? 'Der konfigurierte Tableau-Username-Claim fehlt oder ist ungültig.'
          : error.code === 'TABLEAU_METADATA_FAILED'
          ? 'Tableau-Metadaten nicht verfügbar. Metadata API, Indexierung und Berechtigungen prüfen.'
          : error.code === 'TABLEAU_VERSION_UNSUPPORTED'
          ? `Tableau Server unterstützt REST API ${TABLEAU_REST_API_VERSION} nicht; mindestens Tableau Server ${TABLEAU_MIN_SERVER_VERSION} erforderlich.`
          : error.code === 'TABLEAU_EAS_KEY_MISSING'
          ? 'EAS-Schlüssel fehlt. Tableau-Integration (OAuth 2.0 Trust) einmal erneut speichern, damit ein Schlüssel erzeugt wird.'
          : 'Tableau-Abfrage fehlgeschlagen. Konfiguration und Berechtigungen prüfen.';
        return c.json({ error: message, code: error.code }, error.code === 'TABLEAU_CLAIM_INVALID' || error.status === 403 ? 403 : error.status === 429 ? 429 : 502);
      }
      return c.json({ error: 'Tableau-Abfrage derzeit nicht verfügbar.', code: 'tableau_request_failed' }, 502);
  });
  app.post('/check', async (c) => {
    return c.json(await service!.connectionCheck(c.get('oidcUser')!, c.req.raw.signal));
  });
  app.post('/search', async (c) => {
    const parsed = tableauSearchSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Ungültige Suchparameter.', code: 'invalid_search' }, 400);
    return c.json(await service!.search(c.get('oidcUser')!, parsed.data, c.req.raw.signal));
  });
  app.post('/metadata/search', async (c) => {
    const parsed = tableauMetadataSearchSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Ungültige Metadaten-Suchparameter.', code: 'invalid_search' }, 400);
    return c.json(await service!.metadataSearch(c.get('oidcUser')!, parsed.data, c.req.raw.signal));
  });
  app.post('/metadata/field', async (c) => {
    const parsed = tableauMetadataFieldSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Gültige Metadaten-Feld-ID erforderlich.', code: 'invalid_field' }, 400);
    return c.json(await service!.metadataField(c.get('oidcUser')!, parsed.data, c.req.raw.signal));
  });
  return app;
}
