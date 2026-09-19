import { generateKeyPairSync } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LICENSE_KID,
  encodeLicenseToken,
  hasFeature,
  LICENSE_FORMAT_VERSION,
  loadLicenseFromEnv,
  readLicenseTokenFromEnv,
  signLicensePayload,
  verifyLicense,
} from '../server/src/license';

function keys() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const jwk = publicKey.export({ format: 'jwk' }) as { x: string };
  return { privateKey, b64url: jwk.x };
}

function token(privateKey: ReturnType<typeof keys>['privateKey'], overrides: Record<string, unknown> = {}) {
  const payload = {
    formatVersion: LICENSE_FORMAT_VERSION,
    licenseId: 'lic-1',
    tier: 'enterprise',
    licensee: 'Firma GmbH',
    issuedAt: '2026-09-01T00:00:00Z',
    validUntil: '2030-12-31T23:59:59Z',
    ...overrides,
  };
  const json = JSON.stringify(payload);
  return encodeLicenseToken(json, signLicensePayload(json, privateKey));
}

describe('license verification', () => {
  it('accepts a correctly signed, unexpired license and derives features from the tier', () => {
    const k = keys();
    const status = verifyLicense(token(k.privateKey), { [DEFAULT_LICENSE_KID]: k.b64url }, new Date('2026-09-02'));
    expect(status.status).toBe('valid');
    expect(hasFeature(status, 'sso')).toBe(true);
    expect(hasFeature(status, 'mcp')).toBe(true);
    if (status.status === 'valid') expect(status.license.effectiveFeatures).toEqual(['sso', 'memory', 'savedQueries', 'mcp', 'actions', 'tableauServer']);
  });

  it('honours an explicit (narrower) feature list', () => {
    const k = keys();
    const trusted = { [DEFAULT_LICENSE_KID]: k.b64url };
    const status = verifyLicense(token(k.privateKey, { features: [] }), trusted, new Date('2026-09-02'));
    expect(status.status).toBe('valid');
    expect(hasFeature(status, 'sso')).toBe(false);
    expect(hasFeature(status, 'memory')).toBe(false);

    // Eine Lizenz kann einzelne Enterprise-Funktionen freischalten, ohne alle.
    const memoryOnly = verifyLicense(token(k.privateKey, { features: ['memory'] }), trusted, new Date('2026-09-02'));
    expect(hasFeature(memoryOnly, 'memory')).toBe(true);
    expect(hasFeature(memoryOnly, 'sso')).toBe(false);
    expect(hasFeature(memoryOnly, 'savedQueries')).toBe(false);
    expect(hasFeature(memoryOnly, 'mcp')).toBe(false);
    const mcpOnly = verifyLicense(token(k.privateKey, { features: ['mcp'] }), trusted, new Date('2026-09-02'));
    expect(hasFeature(mcpOnly, 'mcp')).toBe(true);
    expect(hasFeature(mcpOnly, 'sso')).toBe(false);
  });

  it('accepts an explicit tableauServer feature license', () => {
    const k = keys();
    const status = verifyLicense(token(k.privateKey, { features: ['tableauServer'] }), { [DEFAULT_LICENSE_KID]: k.b64url }, new Date('2026-09-02'));
    expect(status.status).toBe('valid');
    expect(hasFeature(status, 'tableauServer')).toBe(true);
    expect(hasFeature(status, 'sso')).toBe(false);
  });

  it('keeps legacy licenses without a feature list on the expanded tier default', () => {
    const k = keys();
    const status = verifyLicense(token(k.privateKey), { [DEFAULT_LICENSE_KID]: k.b64url }, new Date('2026-09-02'));
    expect(status.status).toBe('valid');
    expect(hasFeature(status, 'tableauServer')).toBe(true);
  });

  it('rejects a token signed with another key, a tampered payload and garbage', () => {
    const a = keys();
    const b = keys();
    const keysA = { [DEFAULT_LICENSE_KID]: a.b64url };
    const keysB = { [DEFAULT_LICENSE_KID]: b.b64url };
    expect(verifyLicense(token(a.privateKey), keysB).status).toBe('invalid');
    const t = token(a.privateKey);
    const [payload, sig] = t.split('.');
    const tampered = `${Buffer.from(Buffer.from(payload!, 'base64url').toString('utf8').replace('Firma GmbH', 'Hacker')).toString('base64url')}.${sig}`;
    expect(verifyLicense(tampered, keysA).status).toBe('invalid');
    expect(verifyLicense('nicht.ein.token', keysA).status).toBe('invalid');
    expect(verifyLicense('', keysA).status).toBe('invalid');
  });

  it('reports expired licenses and refuses their features', () => {
    const k = keys();
    const status = verifyLicense(token(k.privateKey, { validUntil: '2026-01-01T00:00:00Z' }), { [DEFAULT_LICENSE_KID]: k.b64url }, new Date('2026-09-02'));
    expect(status.status).toBe('expired');
    expect(hasFeature(status, 'sso')).toBe(false);
  });

  it('rejects other products / unknown features / wrong tier', () => {
    const k = keys();
    const trusted = { [DEFAULT_LICENSE_KID]: k.b64url };
    expect(verifyLicense(token(k.privateKey, { formatVersion: 'certfleet-license-v1' }), trusted).status).toBe('invalid');
    expect(verifyLicense(token(k.privateKey, { features: ['msGraph'] }), trusted).status).toBe('invalid');
    expect(verifyLicense(token(k.privateKey, { tier: 'business' }), trusted).status).toBe('invalid');
  });

  it('falls back to DEFAULT_LICENSE_KID for tokens without an explicit kid', () => {
    const k = keys();
    const status = verifyLicense(token(k.privateKey), { [DEFAULT_LICENSE_KID]: k.b64url }, new Date('2026-09-02'));
    expect(status.status).toBe('valid');
    if (status.status === 'valid') expect(status.license.kid).toBe(DEFAULT_LICENSE_KID);
  });

  it('rejects an unknown kid even with an otherwise validly signed payload', () => {
    const k = keys();
    const t = token(k.privateKey, { kid: 'not-a-real-kid' });
    const status = verifyLicense(t, { [DEFAULT_LICENSE_KID]: k.b64url }, new Date('2026-09-02'));
    expect(status).toMatchObject({ status: 'invalid', reason: expect.stringContaining('not-a-real-kid') });
  });

  it('supports key rotation — a second kid in the map verifies a token signed with its key', () => {
    const a = keys();
    const b = keys();
    const rotated = { [DEFAULT_LICENSE_KID]: a.b64url, 'werkworks-2027': b.b64url };
    const tokenA = token(a.privateKey);
    const tokenB = token(b.privateKey, { kid: 'werkworks-2027' });
    expect(verifyLicense(tokenA, rotated, new Date('2026-09-02')).status).toBe('valid');
    const statusB = verifyLicense(tokenB, rotated, new Date('2026-09-02'));
    expect(statusB.status).toBe('valid');
    if (statusB.status === 'valid') expect(statusB.license.kid).toBe('werkworks-2027');
    // Der alte kid bleibt gültig — Rotation bricht bestehende Lizenzen nicht.
    expect(hasFeature(verifyLicense(tokenA, rotated, new Date('2026-09-02')), 'sso')).toBe(true);
  });

  it('loads the token from env and verifies it against the given trusted keys, never the embedded default', () => {
    const k = keys();
    const t = token(k.privateKey);
    expect(loadLicenseFromEnv({}).status).toBe('none');
    expect(loadLicenseFromEnv({ OVP_LICENSE: t }).status).toBe('invalid'); // eingebauter Standard-Key ≠ Testschlüssel
    expect(
      loadLicenseFromEnv({ OVP_LICENSE: t }, { trustedKeys: { [DEFAULT_LICENSE_KID]: k.b64url }, now: new Date('2026-09-02') }).status,
    ).toBe('valid');

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ovp-lic-'));
    try {
      fs.writeFileSync(path.join(dir, 'license.txt'), `${t}\n`);
      expect(
        loadLicenseFromEnv(
          { OVP_LICENSE_PATH: path.join(dir, 'license.txt') },
          { trustedKeys: { [DEFAULT_LICENSE_KID]: k.b64url }, now: new Date('2026-09-02') },
        ).status,
      ).toBe('valid');
      expect(loadLicenseFromEnv({ OVP_LICENSE: t }, { trustedKeys: { [DEFAULT_LICENSE_KID]: 'kaputt' } }).status).toBe('invalid');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

});

describe('readLicenseTokenFromEnv', () => {
  it('liefert den Token auch aus der Lizenzdatei — nicht nur aus OVP_LICENSE', () => {
    const k = keys();
    const t = token(k.privateKey);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ovp-license-'));
    const file = path.join(dir, 'license');
    // Mit Zeilenumbruch, wie ihn ein gemountetes Secret typischerweise hat.
    fs.writeFileSync(file, `${t}\n`);

    try {
      expect(readLicenseTokenFromEnv({ OVP_LICENSE: t }).token).toBe(t);
      expect(readLicenseTokenFromEnv({ OVP_LICENSE_PATH: file }).token).toBe(t);
      expect(readLicenseTokenFromEnv({}).token).toBeNull();
      expect(readLicenseTokenFromEnv({ OVP_LICENSE_PATH: path.join(dir, 'fehlt') }).error).toMatch(/nicht lesbar/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
