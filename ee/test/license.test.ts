import { generateKeyPairSync } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  encodeLicenseToken,
  hasFeature,
  LICENSE_FORMAT_VERSION,
  loadLicenseFromEnv,
  signLicensePayload,
  verifyLicense,
} from '../server/src/license';

function keys() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const jwk = publicKey.export({ format: 'jwk' }) as { x: string };
  return { publicKey, privateKey, b64url: jwk.x, pem: publicKey.export({ format: 'pem', type: 'spki' }).toString() };
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
    const status = verifyLicense(token(k.privateKey), k.publicKey, new Date('2026-09-02'));
    expect(status.status).toBe('valid');
    expect(hasFeature(status, 'sso')).toBe(true);
    if (status.status === 'valid') expect(status.license.effectiveFeatures).toEqual(['sso', 'memory', 'savedQueries']);
  });

  it('honours an explicit (narrower) feature list', () => {
    const k = keys();
    const status = verifyLicense(token(k.privateKey, { features: [] }), k.publicKey, new Date('2026-09-02'));
    expect(status.status).toBe('valid');
    expect(hasFeature(status, 'sso')).toBe(false);
    expect(hasFeature(status, 'memory')).toBe(false);

    // Eine Lizenz kann einzelne Enterprise-Funktionen freischalten, ohne alle.
    const memoryOnly = verifyLicense(token(k.privateKey, { features: ['memory'] }), k.publicKey, new Date('2026-09-02'));
    expect(hasFeature(memoryOnly, 'memory')).toBe(true);
    expect(hasFeature(memoryOnly, 'sso')).toBe(false);
    expect(hasFeature(memoryOnly, 'savedQueries')).toBe(false);
  });

  it('rejects a token signed with another key, a tampered payload and garbage', () => {
    const a = keys();
    const b = keys();
    expect(verifyLicense(token(a.privateKey), b.publicKey).status).toBe('invalid');
    const t = token(a.privateKey);
    const [payload, sig] = t.split('.');
    const tampered = `${Buffer.from(Buffer.from(payload!, 'base64url').toString('utf8').replace('Firma GmbH', 'Hacker')).toString('base64url')}.${sig}`;
    expect(verifyLicense(tampered, a.publicKey).status).toBe('invalid');
    expect(verifyLicense('nicht.ein.token', a.publicKey).status).toBe('invalid');
    expect(verifyLicense('', a.publicKey).status).toBe('invalid');
  });

  it('reports expired licenses and refuses their features', () => {
    const k = keys();
    const status = verifyLicense(token(k.privateKey, { validUntil: '2026-01-01T00:00:00Z' }), k.publicKey, new Date('2026-09-02'));
    expect(status.status).toBe('expired');
    expect(hasFeature(status, 'sso')).toBe(false);
  });

  it('rejects other products / unknown features / wrong tier', () => {
    const k = keys();
    expect(verifyLicense(token(k.privateKey, { formatVersion: 'certfleet-license-v1' }), k.publicKey).status).toBe('invalid');
    expect(verifyLicense(token(k.privateKey, { features: ['msGraph'] }), k.publicKey).status).toBe('invalid');
    expect(verifyLicense(token(k.privateKey, { tier: 'business' }), k.publicKey).status).toBe('invalid');
  });

  it('loads token and key from env (raw b64url key, PEM file, license file)', () => {
    const k = keys();
    const t = token(k.privateKey);
    expect(loadLicenseFromEnv({}).status).toBe('none');
    expect(loadLicenseFromEnv({ OVP_LICENSE: t }).status).toBe('invalid'); // Standard-Key ≠ Testschlüssel
    expect(loadLicenseFromEnv({ OVP_LICENSE: t, OVP_LICENSE_PUBLIC_KEY_B64URL: k.b64url }, new Date('2026-09-02')).status).toBe('valid');

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ovp-lic-'));
    try {
      fs.writeFileSync(path.join(dir, 'public.pem'), k.pem);
      fs.writeFileSync(path.join(dir, 'license.txt'), `${t}\n`);
      expect(
        loadLicenseFromEnv(
          { OVP_LICENSE_PATH: path.join(dir, 'license.txt'), OVP_LICENSE_PUBLIC_KEY_PATH: path.join(dir, 'public.pem') },
          new Date('2026-09-02'),
        ).status,
      ).toBe('valid');
      expect(loadLicenseFromEnv({ OVP_LICENSE: t, OVP_LICENSE_PUBLIC_KEY_B64URL: 'kaputt' }).status).toBe('invalid');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
