import { generateKeyPairSync } from 'node:crypto';
import { encodeLicenseToken, LICENSE_FORMAT_VERSION, signLicensePayload, type EeFeature } from '@openvizpilot/ee/server';
import type { AppConfig } from '../src/env';

/**
 * Baut eine echte, signierte Enterprise-Lizenz für Tests — mit einem
 * Wegwerf-Schlüsselpaar, dessen Public Key gleich mitgeliefert wird. So laufen
 * Lizenz-Tests durch dieselbe Signaturprüfung wie in Produktion, ohne den
 * Schlüssel des Betreibers zu berühren.
 *
 * `features` weggelassen = alle Features des Tiers (die App leitet sie ab);
 * eine leere Liste ergibt eine gültige Lizenz OHNE Enterprise-Funktionen.
 */
export function testLicenseEnv(features?: EeFeature[], validUntil?: string): AppConfig['licenseEnv'] {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const payload = JSON.stringify({
    formatVersion: LICENSE_FORMAT_VERSION,
    licenseId: 'test-license',
    tier: 'enterprise',
    licensee: 'Test GmbH',
    issuedAt: new Date(Date.now() - 86_400_000).toISOString(),
    validUntil: validUntil ?? new Date(Date.now() + 86_400_000).toISOString(),
    ...(features ? { features } : {}),
  });
  return {
    OVP_LICENSE: encodeLicenseToken(payload, signLicensePayload(payload, privateKey)),
    OVP_LICENSE_PUBLIC_KEY_B64URL: (publicKey.export({ format: 'jwk' }) as { x: string }).x,
  };
}
