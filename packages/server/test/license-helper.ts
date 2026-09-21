import { generateKeyPairSync } from 'node:crypto';
import {
  DEFAULT_LICENSE_KID,
  encodeLicenseToken,
  LEASE_FORMAT_VERSION,
  LICENSE_FORMAT_VERSION,
  signLicensePayload,
  type EeFeature,
  type TelemetryStore,
} from '@openvizpilot/ee/server';
import type { AuthStateProvider } from '../src/auth-state';
import type { AppConfig } from '../src/env';

export const TEST_LICENSE_ID = 'test-license';
export const TEST_LEASE_KID = 'test-lease';

/**
 * Wegwerf-Schlüsselpaar für Leases (einmal je Testprozess). Sein Public Key
 * wandert als `leaseTrustedKeys` in die AppConfig — rein programmatisch, wie
 * `licenseTrustedKeys` — und `signTestLease` signiert dazu passende Leases.
 */
const leaseKeyPair = generateKeyPairSync('ed25519');
export const TEST_LEASE_TRUSTED_KEYS: Record<string, string> = {
  [TEST_LEASE_KID]: (leaseKeyPair.publicKey.export({ format: 'jwk' }) as { x: string }).x,
};

export function signTestLease(payload: { installationId: string; licenseId?: string; leaseUntil?: string; offline?: boolean; kid?: string }): string {
  const json = JSON.stringify({
    formatVersion: LEASE_FORMAT_VERSION,
    kid: payload.kid ?? TEST_LEASE_KID,
    licenseId: payload.licenseId ?? TEST_LICENSE_ID,
    installationId: payload.installationId,
    licensee: 'Test GmbH',
    environment: 'production',
    features: ['sso'],
    issuedAt: new Date(Date.now() - 60_000).toISOString(),
    leaseUntil: payload.leaseUntil ?? new Date(Date.now() + 7 * 86_400_000).toISOString(),
    ...(payload.offline ? { offline: true } : {}),
  });
  return encodeLicenseToken(json, signLicensePayload(json, leaseKeyPair.privateKey));
}

/**
 * Aktiviert eine Test-Installation auf dem echten Weg: Lease für ihre
 * Installations-ID signieren, im Telemetrie-Store speichern, Auth-Zustand
 * neu lesen. Ohne das bleibt eine lizenzierte Installation `pending` (Core).
 */
export async function activated<T extends { telemetryStore: TelemetryStore | null; authState: AuthStateProvider }>(
  instance: T,
  options: { licenseId?: string; leaseUntil?: string; offline?: boolean } = {},
): Promise<T> {
  if (!instance.telemetryStore) throw new Error('activated(): Installation ohne Datenbank kann nicht aktiviert werden');
  await instance.telemetryStore.saveLease(signTestLease({ installationId: await instance.telemetryStore.getInstallationId(), ...options }));
  instance.authState.invalidate();
  return instance;
}

/**
 * Baut eine echte, signierte Enterprise-Lizenz für Tests — mit einem
 * Wegwerf-Schlüsselpaar, dessen Public Key als `licenseTrustedKeys` (eine rein
 * programmatische, nicht aus Env/Datei/DB befüllbare AppConfig-Option)
 * mitgeliefert wird. So laufen Lizenz-Tests durch dieselbe Signaturprüfung
 * wie in Produktion, ohne den eingebauten Vertrauensanker (TRUSTED_LICENSE_KEYS)
 * zu berühren. Aufrufer spreaden das Ergebnis direkt in ihre AppConfig, z. B.
 * `testConfig({ ...testLicenseEnv(['memory']) })`, und aktivieren die
 * Installation anschließend mit `activated(createApp(...))`.
 *
 * `features` weggelassen = alle Features des Tiers (die App leitet sie ab);
 * eine leere Liste ergibt eine gültige Lizenz OHNE Enterprise-Funktionen.
 */
export function testLicenseEnv(features?: EeFeature[], validUntil?: string): Pick<AppConfig, 'licenseEnv' | 'licenseTrustedKeys' | 'leaseTrustedKeys'> {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const payload = JSON.stringify({
    formatVersion: LICENSE_FORMAT_VERSION,
    licenseId: TEST_LICENSE_ID,
    tier: 'enterprise',
    licensee: 'Test GmbH',
    issuedAt: new Date(Date.now() - 86_400_000).toISOString(),
    validUntil: validUntil ?? new Date(Date.now() + 86_400_000).toISOString(),
    ...(features ? { features } : {}),
  });
  return {
    licenseEnv: { OVP_LICENSE: encodeLicenseToken(payload, signLicensePayload(payload, privateKey)) },
    licenseTrustedKeys: { [DEFAULT_LICENSE_KID]: (publicKey.export({ format: 'jwk' }) as { x: string }).x },
    leaseTrustedKeys: TEST_LEASE_TRUSTED_KEYS,
  };
}
