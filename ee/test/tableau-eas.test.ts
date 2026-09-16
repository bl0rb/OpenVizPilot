import { createPublicKey, verify as cryptoVerify } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  EAS_JWT_TTL_SECONDS,
  EAS_PATH,
  EAS_SCOPE,
  easDiscoveryDocument,
  easIssuerUrl,
  easJwks,
  generateEasKey,
  signEasJwt,
  type TableauEasKey,
} from '../server/src/tableau-server/eas';
import { createPgTableauStore, createSqliteTableauStore } from '../server/src/tableau-server/store';
import { openSqliteDatabase } from '../../packages/server/src/memory/sqlite-store';

function decodeSegment(segment: string): unknown {
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
}

/** Verifiziert die Signatur eines EAS-JWT gegen den öffentlichen JWK — wie Tableau es täte. */
function verifyEasJwt(jwt: string, key: TableauEasKey): boolean {
  const [header, payload, signature] = jwt.split('.');
  const publicKey = createPublicKey({ key: key.publicJwk, format: 'jwk' });
  return cryptoVerify('RSA-SHA256', Buffer.from(`${header}.${payload}`, 'utf8'), publicKey, Buffer.from(signature!, 'base64url'));
}

describe('Tableau EAS key material and tokens', () => {
  it('generates a 2048-bit RSA key whose public JWK matches the private key', () => {
    const key = generateEasKey();
    expect(key.kid).toMatch(/^[0-9a-f]{16}$/);
    expect(key.privateKeyPem).toContain('BEGIN PRIVATE KEY');
    expect(key.publicJwk).toEqual({ kty: 'RSA', n: expect.any(String), e: expect.any(String), kid: key.kid, use: 'sig', alg: 'RS256' });
    const publicKeyFromPrivate = createPublicKey(key.privateKeyPem);
    expect(publicKeyFromPrivate.asymmetricKeyDetails?.modulusLength).toBe(2048);
    expect(publicKeyFromPrivate.export({ format: 'jwk' })).toMatchObject({ n: key.publicJwk.n, e: key.publicJwk.e });
    expect(new Date(key.createdAt).toISOString()).toBe(key.createdAt);
  });

  it('publishes exactly the one public key in the JWKS, carrying kid/use/alg', () => {
    const key = generateEasKey();
    expect(easJwks(key)).toEqual({ keys: [key.publicJwk] });
  });

  it('advertises jwks_uri under the issuer in the discovery document', () => {
    const issuer = 'https://ovp.example.com/tableau-eas';
    const doc = easDiscoveryDocument(issuer);
    expect(doc.issuer).toBe(issuer);
    expect(doc.jwks_uri).toBe(`${issuer}/jwks.json`);
    expect(doc.id_token_signing_alg_values_supported).toEqual(['RS256']);
    expect(doc.response_types_supported.length).toBeGreaterThan(0);
    expect(doc.subject_types_supported.length).toBeGreaterThan(0);
  });

  it('derives the issuer from the public URL origin and rejects non-HTTPS', () => {
    expect(easIssuerUrl('https://ovp.example.com')).toBe(`https://ovp.example.com${EAS_PATH}`);
    expect(easIssuerUrl('https://ovp.example.com/some/path?x=1')).toBe(`https://ovp.example.com${EAS_PATH}`);
    expect(() => easIssuerUrl('http://ovp.example.com')).toThrow();
  });

  it('signs a JWT whose signature verifies against the published JWK, with the required claims', () => {
    const key = generateEasKey();
    const issuer = easIssuerUrl('https://ovp.example.com');
    const now = 1_750_000_000_000;
    const jwt = signEasJwt(key, { issuer, username: 'alice@example.com', siteId: 'site-luid-123', now });
    expect(verifyEasJwt(jwt, key)).toBe(true);

    const [headerSegment, payloadSegment] = jwt.split('.');
    const header = decodeSegment(headerSegment!) as Record<string, unknown>;
    const payload = decodeSegment(payloadSegment!) as Record<string, unknown>;

    expect(header).toEqual({ alg: 'RS256', typ: 'JWT', kid: key.kid });
    expect(payload.iss).toBe(issuer);
    expect(payload.sub).toBe('alice@example.com');
    expect(payload.aud).toBe('tableau:site-luid-123');
    expect(Array.isArray(payload.scp)).toBe(true);
    expect(payload.scp).toEqual([EAS_SCOPE]);
    expect((payload.exp as number) - (payload.iat as number)).toBe(300);
    expect(payload.exp as number).toBe((payload.iat as number) + EAS_JWT_TTL_SECONDS);
    expect(typeof payload.jti).toBe('string');
    expect(payload.jti).not.toBe('');
  });

  it('mints a fresh jti per call and rejects a JWT signed by an unrelated key', () => {
    const key = generateEasKey();
    const otherKey = generateEasKey();
    const issuer = easIssuerUrl('https://ovp.example.com');
    const jwtA = signEasJwt(key, { issuer, username: 'alice', siteId: 'site' });
    const jwtB = signEasJwt(key, { issuer, username: 'alice', siteId: 'site' });
    const jtiOf = (jwt: string) => (decodeSegment(jwt.split('.')[1]!) as { jti: string }).jti;
    expect(jtiOf(jwtA)).not.toBe(jtiOf(jwtB));
    expect(verifyEasJwt(jwtA, otherKey)).toBe(false);
  });
});

describe('Tableau EAS key persistence', () => {
  it('SQLite: returns null before any key exists, then persists and returns it unchanged', async () => {
    const db = openSqliteDatabase(':memory:');
    const store = createSqliteTableauStore(db);
    try {
      expect(await store.getEasKey()).toBeNull();
      const key = generateEasKey();
      await store.saveEasKey(key);
      expect(await store.getEasKey()).toEqual(key);
    } finally {
      db.close();
    }
  });

  it('SQLite: first key wins — a second save never overwrites the stored key (multi-replica safety)', async () => {
    const db = openSqliteDatabase(':memory:');
    const store = createSqliteTableauStore(db);
    try {
      const first = generateEasKey();
      const second = generateEasKey();
      await store.saveEasKey(first);
      await store.saveEasKey(second);
      const stored = await store.getEasKey();
      expect(stored).toEqual(first);
      expect(stored).not.toEqual(second);
    } finally {
      db.close();
    }
  });

  it('Postgres: first-wins insert uses ON CONFLICT DO NOTHING and never overwrites the stored key', async () => {
    const rows: Array<{ key: string }> = [];
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes('INSERT INTO ee_tableau_eas_key')) {
        if (rows.length === 0) rows.push({ key: params![0] as string });
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes('SELECT key FROM ee_tableau_eas_key')) {
        return { rows: rows.length > 0 ? [{ key: rows[0]!.key }] : [], rowCount: rows.length };
      }
      return { rows: [], rowCount: 0 };
    });
    const store = createPgTableauStore({ query, connect: async () => ({ query, release() {} }) });

    expect(await store.getEasKey()).toBeNull();
    const first = generateEasKey();
    const second = generateEasKey();
    await store.saveEasKey(first);
    await store.saveEasKey(second);
    expect(await store.getEasKey()).toEqual(first);

    const insertCall = query.mock.calls.find(([sql]) => sql.includes('INSERT INTO ee_tableau_eas_key'));
    expect(insertCall?.[0]).toContain('ON CONFLICT (id) DO NOTHING');
    expect(insertCall?.[1]?.[0]).toEqual(expect.any(String));
  });
});
