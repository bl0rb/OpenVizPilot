import { Hono } from 'hono';
import { easDiscoveryDocument, easIssuerUrl, easJwks, type TableauEasKey } from './eas';
import type { TableauStore } from './store';

/**
 * Öffentliche OIDC-Discovery-/JWKS-Route für den EAS-Modus (Tableau Connected App
 * „OAuth 2.0 Trust"). Absichtlich ohne Authentifizierung — Tableau ruft beide URLs
 * unangemeldet auf, siehe eas.ts. Liefert nur, was ohnehin öffentlich sein darf: den
 * Issuer und den öffentlichen JWK; niemals den privaten Schlüssel (store.getEasKey()
 * gibt ihn zwar zurück, aber diese Route liest ihn nur, um `easJwks`/`kid` daraus
 * abzuleiten, und gibt das Ergebnisobjekt nie unverändert weiter).
 *
 * 404 (statt z. B. 503), solange der Modus nicht `oauth2-trust` ist oder noch kein
 * Schlüssel existiert — das entspricht "hier gibt es nichts", nicht "vorübergehend
 * nicht verfügbar", und verrät nicht, ob eine Tableau-Integration überhaupt existiert.
 */
export function createTableauEasRoute(store: TableauStore | null, publicUrl: () => Promise<string | null>): Hono {
  const app = new Hono();

  const context = async (): Promise<{ issuer: string; key: TableauEasKey } | null> => {
    if (!store) return null;
    const { config } = await store.get();
    // Ein gemeinsames EAS-Schlüsselpaar bedient alle Sites im oauth2-trust-Modus.
    if (!config?.sites.some((site) => site.authMode === 'oauth2-trust')) return null;
    const key = await store.getEasKey();
    if (!key) return null;
    const url = await publicUrl();
    if (!url) return null;
    try {
      return { issuer: easIssuerUrl(url), key };
    } catch {
      return null;
    }
  };

  app.use('*', async (c, next) => {
    await next();
    if (c.res.status === 200) c.header('cache-control', 'public, max-age=300');
  });

  app.get('/.well-known/openid-configuration', async (c) => {
    const ctx = await context();
    if (!ctx) return c.notFound();
    return c.json(easDiscoveryDocument(ctx.issuer));
  });

  app.get('/jwks.json', async (c) => {
    const ctx = await context();
    if (!ctx) return c.notFound();
    return c.json(easJwks(ctx.key));
  });

  return app;
}
