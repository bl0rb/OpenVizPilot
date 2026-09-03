import { createHash, generateKeyPairSync } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OidcClient, OidcError } from '../server/src/oidc';
import { mintRs256, startMockOidc, type MockOidc } from './mock-oidc-server';

let idp: MockOidc;
beforeAll(async () => {
  idp = await startMockOidc();
});
afterAll(async () => {
  await idp.close();
});

function client(overrides: Partial<ConstructorParameters<typeof OidcClient>[0]> = {}) {
  return new OidcClient({ issuer: idp.issuer, clientId: idp.clientId, scopes: 'openid profile email', provider: 'generic', ...overrides });
}

describe('OidcClient.verifyIdToken', () => {
  it('accepts a valid RS256 ID token from the JWKS and exposes sub/email/name', async () => {
    const user = await client().verifyIdToken(idp.mintIdToken());
    expect(user).toMatchObject({ sub: 'user-42', email: 'anna@example.com', name: 'Anna Beispiel' });
    expect(user.expiresAt).toBeGreaterThan(Date.now());
  });

  it('rejects wrong audience, wrong issuer, expired and not-yet-valid tokens', async () => {
    const c = client();
    await expect(c.verifyIdToken(idp.mintIdToken({ aud: 'other-app' }))).rejects.toThrow(/Audience/);
    await expect(c.verifyIdToken(idp.mintIdToken({ iss: 'https://evil.example' }))).rejects.toThrow(/Issuer/);
    const past = Math.floor(Date.now() / 1000) - 3600;
    await expect(c.verifyIdToken(idp.mintIdToken({ exp: past }))).rejects.toThrow(/abgelaufen/);
    await expect(c.verifyIdToken(idp.mintIdToken({ nbf: past + 7200 }))).rejects.toThrow(/noch nicht/);
  });

  it('rejects tokens signed by a foreign key, alg=none and unknown kids', async () => {
    const c = client();
    const foreign = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
    const now = Math.floor(Date.now() / 1000);
    const payload = { iss: idp.issuer, aud: idp.clientId, sub: 'x', exp: now + 600, iat: now };
    await expect(c.verifyIdToken(mintRs256(payload, foreign, 'mock-key-1'))).rejects.toThrow(/Signatur/);
    await expect(c.verifyIdToken(mintRs256(payload, foreign, 'unknown-kid'))).rejects.toThrow(/kid/);
    const [h, p] = idp.mintIdToken().split('.');
    const noneHeader = Buffer.from(JSON.stringify({ alg: 'none', kid: 'mock-key-1' })).toString('base64url');
    await expect(c.verifyIdToken(`${noneHeader}.${p}.`)).rejects.toThrow(/Signaturalgorithmus/);
    expect(h).toBeTruthy();
    await expect(c.verifyIdToken('kein-jwt')).rejects.toThrow(OidcError);
  });

  it('never contacts the JWKS endpoint for implausible tokens and throttles forced refreshes', async () => {
    let jwksFetches = 0;
    const counting: typeof fetch = async (input, init) => {
      if (String(input).endsWith('/jwks')) jwksFetches += 1;
      return fetch(input, init);
    };
    const c = new OidcClient({ issuer: idp.issuer, clientId: idp.clientId, scopes: 'openid', provider: 'generic' }, counting);
    const foreign = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
    const now = Math.floor(Date.now() / 1000);
    const base = { iss: idp.issuer, aud: idp.clientId, sub: 'x', exp: now + 600, iat: now };
    // Fremder Issuer / falsche Audience / abgelaufen → Ablehnung ohne JWKS-Abruf.
    await expect(c.verifyIdToken(mintRs256({ ...base, iss: 'https://evil.example' }, foreign, 'k1'))).rejects.toThrow(/Issuer/);
    await expect(c.verifyIdToken(mintRs256({ ...base, aud: 'other' }, foreign, 'k2'))).rejects.toThrow(/Audience/);
    await expect(c.verifyIdToken(mintRs256({ ...base, exp: now - 3600 }, foreign, 'k3'))).rejects.toThrow(/abgelaufen/);
    expect(jwksFetches).toBe(0);
    // Plausibles Token mit unbekanntem kid: genau EIN erzwungener Abruf (plus
    // der initiale Cache-Füll-Abruf) — weitere unbekannte kids in der
    // Abkühlphase lösen keinen weiteren Abruf aus.
    for (let i = 0; i < 5; i++) {
      await expect(c.verifyIdToken(mintRs256(base, foreign, `unknown-${i}`))).rejects.toThrow(/kid/);
    }
    expect(jwksFetches).toBe(2);
    // Gültige Tokens funktionieren weiterhin aus dem Cache.
    await expect(c.verifyIdToken(idp.mintIdToken())).resolves.toMatchObject({ sub: 'user-42' });
    expect(jwksFetches).toBe(2);
  });

  it('accepts aud as an array containing the client id', async () => {
    await expect(client().verifyIdToken(idp.mintIdToken({ aud: ['x', idp.clientId] }))).resolves.toMatchObject({ sub: 'user-42' });
  });
});

describe('OidcClient.exchangeCode (PKCE)', () => {
  it('exchanges a code issued for the matching challenge and rejects a wrong verifier', async () => {
    const c = client();
    const verifier = 'a'.repeat(64);
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const redirectUri = 'https://chat.example.com/auth/callback';
    const url = await c.authorizationUrl({ redirectUri, state: 's1', codeChallenge: challenge });
    const res = await fetch(url, { redirect: 'manual' });
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get('location')!);
    expect(location.origin + location.pathname).toBe(redirectUri);
    expect(location.searchParams.get('state')).toBe('s1');
    const code = location.searchParams.get('code')!;

    await expect(c.exchangeCode({ code, codeVerifier: 'b'.repeat(64), redirectUri })).rejects.toThrow(/abgelehnt/);
    const { idToken, user } = await c.exchangeCode({ code, codeVerifier: verifier, redirectUri });
    expect(user.sub).toBe('user-42');
    expect(idToken.split('.')).toHaveLength(3);
    // Code ist einmalig
    await expect(c.exchangeCode({ code, codeVerifier: verifier, redirectUri })).rejects.toThrow(/abgelehnt/);
  });

  it('reports an unreachable issuer as a configuration error', async () => {
    const c = client({ issuer: 'http://127.0.0.1:1' });
    await expect(c.discovery()).rejects.toMatchObject({ kind: 'config' });
  });
});
