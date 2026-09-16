import { createHash, createSign, generateKeyPairSync, randomUUID } from 'node:crypto';

/**
 * Tableau Connected App „OAuth 2.0 Trust": OpenVizPilot tritt gegenüber
 * Tableau als External Authorization Server (EAS) auf. Reine Funktionen,
 * keine I/O — Schlüsselerzeugung, OIDC-Discovery/JWKS-Dokumente und die
 * RS256-Signatur des kurzlebigen Sign-in-JWTs. Persistenz: store.ts
 * (getEasKey/saveEasKey). Routen/Admin-Verdrahtung: routes.ts/service.ts.
 *
 * Der private Schlüssel (`privateKeyPem`) verlässt diese Schicht nie über
 * eine Antwort — nur `publicJwk` (und der davon abgeleitete `kid`) ist für
 * Tableau bestimmt und darf veröffentlicht werden.
 */

export interface TableauEasKey {
  /** Key-ID — aus dem öffentlichen Schlüssel abgeleitet (sha256(SPKI-DER), erste 16 Hex-Zeichen). */
  kid: string;
  /** PKCS8 PEM, RSA 2048 — niemals loggen, niemals über eine Admin-API zurückgeben. */
  privateKeyPem: string;
  publicJwk: { kty: 'RSA'; n: string; e: string; kid: string; use: 'sig'; alg: 'RS256' };
  createdAt: string;
}

/** Issuer-Pfad unter der Public URL der Middleware. */
export const EAS_PATH = '/tableau-eas';
export const EAS_SCOPE = 'tableau:content:read';
/** Höchstens 10 Minuten laut Tableau-Vorgabe — wir nehmen die knappere Hälfte. */
export const EAS_JWT_TTL_SECONDS = 300;

function base64urlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

/** RSA-2048-Schlüsselpaar für den EAS-Modus. */
export function generateEasKey(): TableauEasKey {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const spkiDer = publicKey.export({ type: 'spki', format: 'der' });
  const kid = createHash('sha256').update(spkiDer).digest('hex').slice(0, 16);
  const { n, e } = publicKey.export({ format: 'jwk' }) as { n: string; e: string };
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  return {
    kid,
    privateKeyPem,
    publicJwk: { kty: 'RSA', n, e, kid, use: 'sig', alg: 'RS256' },
    createdAt: new Date().toISOString(),
  };
}

/** Issuer-URL aus der Public URL der Middleware — dieselbe, aus der die OIDC-Redirect-URI entsteht. */
export function easIssuerUrl(publicUrl: string): string {
  const url = new URL(publicUrl);
  if (url.protocol !== 'https:') throw new Error('EAS-Issuer-URL erfordert eine HTTPS-Public-URL');
  return `${url.origin}${EAS_PATH}`;
}

export function easDiscoveryDocument(issuer: string): {
  issuer: string;
  jwks_uri: string;
  response_types_supported: string[];
  subject_types_supported: string[];
  id_token_signing_alg_values_supported: ['RS256'];
} {
  return {
    issuer,
    jwks_uri: `${issuer}/jwks.json`,
    response_types_supported: ['id_token'],
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['RS256'],
  };
}

export function easJwks(key: TableauEasKey): { keys: TableauEasKey['publicJwk'][] } {
  return { keys: [key.publicJwk] };
}

/**
 * Signiert das Sign-in-JWT für `POST {serverUrl}/api/.../auth/signin`. `username` muss bereits der
 * unveränderte Wert des konfigurierten `usernameClaim` aus den von oidc.ts verifizierten Claims sein —
 * diese Funktion nimmt keine Normalisierung oder Ersatzidentität vor.
 */
export function signEasJwt(key: TableauEasKey, input: { issuer: string; username: string; siteId: string; now?: number }): string {
  const iat = Math.floor((input.now ?? Date.now()) / 1000);
  const header = { alg: 'RS256', typ: 'JWT', kid: key.kid };
  const payload = {
    iss: input.issuer,
    sub: input.username,
    aud: `tableau:${input.siteId}`,
    iat,
    exp: iat + EAS_JWT_TTL_SECONDS,
    jti: randomUUID(),
    scp: [EAS_SCOPE],
  };
  const signingInput = `${base64urlJson(header)}.${base64urlJson(payload)}`;
  const signature = createSign('RSA-SHA256').update(signingInput, 'utf8').sign(key.privateKeyPem, 'base64url');
  return `${signingInput}.${signature}`;
}
