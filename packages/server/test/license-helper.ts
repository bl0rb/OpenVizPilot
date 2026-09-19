import { generateKeyPairSync } from 'node:crypto';
import { DEFAULT_LICENSE_KID, encodeLicenseToken, LICENSE_FORMAT_VERSION, signLicensePayload, type EeFeature } from '@openvizpilot/ee/server';
import type { AppConfig } from '../src/env';

/**
 * Baut eine echte, signierte Enterprise-Lizenz für Tests — mit einem
 * Wegwerf-Schlüsselpaar, dessen Public Key als `licenseTrustedKeys` (eine rein
 * programmatische, nicht aus Env/Datei/DB befüllbare AppConfig-Option)
 * mitgeliefert wird. So laufen Lizenz-Tests durch dieselbe Signaturprüfung
 * wie in Produktion, ohne den eingebauten Vertrauensanker (TRUSTED_LICENSE_KEYS)
 * zu berühren. Aufrufer spreaden das Ergebnis direkt in ihre AppConfig, z. B.
 * `testConfig({ ...testLicenseEnv(['memory']) })`.
 *
 * `features` weggelassen = alle Features des Tiers (die App leitet sie ab);
 * eine leere Liste ergibt eine gültige Lizenz OHNE Enterprise-Funktionen.
 */
export function testLicenseEnv(features?: EeFeature[], validUntil?: string): Pick<AppConfig, 'licenseEnv' | 'licenseTrustedKeys'> {
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
    licenseEnv: { OVP_LICENSE: encodeLicenseToken(payload, signLicensePayload(payload, privateKey)) },
    licenseTrustedKeys: { [DEFAULT_LICENSE_KID]: (publicKey.export({ format: 'jwk' }) as { x: string }).x },
  };
}
