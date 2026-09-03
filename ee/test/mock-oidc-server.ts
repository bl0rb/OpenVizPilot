import { createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Minimaler OIDC-Provider für Tests und die lokale Entwicklung (Discovery,
 * JWKS, Authorization-Endpunkt mit Auto-Login, Token-Endpunkt mit PKCE-
 * Prüfung, RS256-ID-Tokens). Verhält sich in den geprüften Punkten wie
 * Entra ID / Keycloak: kid im Header, iss/aud/exp/nbf/sub/email/name im Payload.
 */

export interface MockOidcOptions {
  clientId?: string;
  /** Fester Nutzer, der bei jedem Login "angemeldet" wird. */
  user?: { sub: string; email: string; name: string };
  /** ID-Token-Lebensdauer in Sekunden. */
  tokenTtlS?: number;
  /** Fester Port (Dev-Script); Tests lassen ihn weg (freier Port). */
  port?: number;
}

export interface MockOidc {
  issuer: string;
  clientId: string;
  /** Erzeugt ein signiertes ID-Token für Tests (optional mit Abweichungen). */
  mintIdToken(overrides?: Record<string, unknown>, header?: Record<string, unknown>): string;
  /** Alle bisher ausgestellten Codes mit ihren PKCE-Challenges. */
  issuedCodes: Map<string, { challenge: string; redirectUri: string }>;
  close(): Promise<void>;
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

export function mintRs256(payload: Record<string, unknown>, privateKey: KeyObject, kid: string, headerOverrides: Record<string, unknown> = {}): string {
  const header = { alg: 'RS256', typ: 'JWT', kid, ...headerOverrides };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const signature = sign('RSA-SHA256', Buffer.from(signingInput), privateKey);
  return `${signingInput}.${b64url(signature)}`;
}

export async function startMockOidc(options: MockOidcOptions = {}): Promise<MockOidc> {
  const clientId = options.clientId ?? 'openvizpilot-test';
  const user = options.user ?? { sub: 'user-42', email: 'anna@example.com', name: 'Anna Beispiel' };
  const ttl = options.tokenTtlS ?? 3600;
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const kid = 'mock-key-1';
  const jwk = publicKey.export({ format: 'jwk' }) as { n: string; e: string };
  const issuedCodes = new Map<string, { challenge: string; redirectUri: string }>();
  let issuer = '';

  const mintIdToken = (overrides: Record<string, unknown> = {}, header: Record<string, unknown> = {}) => {
    const now = Math.floor(Date.now() / 1000);
    return mintRs256(
      { iss: issuer, aud: clientId, sub: user.sub, email: user.email, name: user.name, iat: now, nbf: now, exp: now + ttl, ...overrides },
      privateKey,
      kid,
      header,
    );
  };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', issuer);
    if (url.pathname === '/.well-known/openid-configuration') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          issuer,
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: `${issuer}/token`,
          jwks_uri: `${issuer}/jwks`,
        }),
      );
      return;
    }
    if (url.pathname === '/jwks') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ keys: [{ kty: 'RSA', kid, use: 'sig', alg: 'RS256', n: jwk.n, e: jwk.e }] }));
      return;
    }
    if (url.pathname === '/authorize') {
      // Auto-Login: Code ausstellen und sofort auf die redirect_uri zurückleiten.
      const redirectUri = url.searchParams.get('redirect_uri') ?? '';
      const state = url.searchParams.get('state') ?? '';
      const challenge = url.searchParams.get('code_challenge') ?? '';
      if (url.searchParams.get('client_id') !== clientId || url.searchParams.get('code_challenge_method') !== 'S256' || !redirectUri) {
        res.writeHead(400, { 'content-type': 'text/plain' });
        res.end('invalid_request');
        return;
      }
      const code = `code-${issuedCodes.size + 1}-${Math.random().toString(36).slice(2, 10)}`;
      issuedCodes.set(code, { challenge, redirectUri });
      const target = new URL(redirectUri);
      target.searchParams.set('code', code);
      target.searchParams.set('state', state);
      res.writeHead(302, { location: target.toString() });
      res.end();
      return;
    }
    if (url.pathname === '/token' && req.method === 'POST') {
      let raw = '';
      req.on('data', (c: Buffer) => (raw += c.toString()));
      req.on('end', () => {
        const form = new URLSearchParams(raw);
        const entry = issuedCodes.get(form.get('code') ?? '');
        const verifier = form.get('code_verifier') ?? '';
        const expected = entry ? createHash('sha256').update(verifier).digest('base64url') : '';
        if (
          !entry ||
          form.get('grant_type') !== 'authorization_code' ||
          form.get('client_id') !== clientId ||
          form.get('redirect_uri') !== entry.redirectUri ||
          expected !== entry.challenge
        ) {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'invalid_grant' }));
          return;
        }
        issuedCodes.delete(form.get('code') ?? ''); // Code ist einmalig
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ id_token: mintIdToken(), access_token: 'opaque', token_type: 'Bearer', expires_in: ttl }));
      });
      return;
    }
    res.writeHead(404).end();
  });

  await new Promise<void>((resolve) => server.listen(options.port ?? 0, '127.0.0.1', resolve));
  issuer = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  return {
    issuer,
    clientId,
    mintIdToken,
    issuedCodes,
    close: () => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}
