/**
 * Lokaler Mock-OIDC-Provider für `npm run dev:demo:sso` — Auto-Login als
 * "Anna Beispiel", RS256-ID-Tokens, PKCE-Prüfung. Startet auf Port 4030 und
 * gibt die Env-Werte aus, die die Middleware braucht.
 */
import { startMockOidc } from '../test/mock-oidc-server';

const port = Number(process.env.MOCK_OIDC_PORT ?? 4030);
const clientId = process.env.OIDC_CLIENT_ID ?? 'openvizpilot-dev';
const mock = await startMockOidc({ clientId, port });
console.log(`[mock-oidc] Issuer: ${mock.issuer}`);
console.log(`[mock-oidc] .env: AUTH_MODE=oidc OIDC_PROVIDER=generic OIDC_ISSUER=${mock.issuer} OIDC_CLIENT_ID=${clientId}`);
console.log('[mock-oidc] Lizenz: npm run sign-license -w @openvizpilot/ee -- keygen ./keys && … sign ./keys/private.pem "Dev" 2030-12-31');
