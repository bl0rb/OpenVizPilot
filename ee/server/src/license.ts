import { createPublicKey, sign, verify, type KeyObject } from 'node:crypto';
import fs from 'node:fs';
import { z } from 'zod';

/**
 * Enterprise-Lizenz — Token-Format identisch zum WerkWorks-Lizenzgenerator
 * (certpulse-license-generator, künftig produktübergreifend):
 *
 *   <base64url(UTF-8 JSON-Payload)>.<base64url(Ed25519-Signatur)>
 *
 * Die Signatur deckt die ROHEN UTF-8-Bytes des JSON-Payloads ab (nicht den
 * base64url-String). Vertrauensanker ist der eingebettete Public Key des
 * WerkWorks-Lizenzgenerators (DEFAULT_LICENSE_PUBLIC_KEY_B64URL) — er ist
 * öffentlich, verrät nichts und macht Lizenzen des Generators ohne weitere
 * Konfiguration gültig. OVP_LICENSE_PUBLIC_KEY_B64URL (rohe 32 Bytes
 * base64url, wie `keygen` sie ausgibt) oder OVP_LICENSE_PUBLIC_KEY_PATH (PEM)
 * überschreiben ihn: Schlüsselrotation oder ein eigener Vertrauensanker
 * brauchen damit keinen Release. Nie aus der DB/Admin-UI — sonst könnte sich
 * ein Admin mit eigenem Schlüsselpaar selbst Lizenzen ausstellen.
 *
 * Open-Core-Grundzustand ist "keine Lizenz": Alle Kernfunktionen laufen
 * ohne Token; die Enterprise-Features (siehe EE_FEATURES) verlangen eine
 * gültige, nicht abgelaufene Lizenz mit dem passenden Schlüssel.
 */

export const LICENSE_FORMAT_VERSION = 'openvizpilot-license-v1';

/**
 * Ed25519-Public-Key des WerkWorks-Lizenzgenerators (certpulse-license-
 * generator/keys/public.pem, rohe 32 Bytes base64url) — der Standard-
 * Vertrauensanker. OVP_LICENSE_PUBLIC_KEY_B64URL/_PATH überschreiben ihn
 * (Schlüsselrotation ohne Release).
 */
export const DEFAULT_LICENSE_PUBLIC_KEY_B64URL = 'NFitkQQZAptFWMB-YAdHzrMzkO9p76ljOdWrQROUFF4';

/** Enterprise-Feature-Schlüssel — müssen im Lizenzgenerator identisch heißen. */
export const EE_FEATURES = ['sso', 'memory', 'savedQueries'] as const;
export type EeFeature = (typeof EE_FEATURES)[number];

export const EE_FEATURE_LABELS: Record<EeFeature, string> = {
  sso: 'Single Sign-On (OIDC: Microsoft Entra ID, Keycloak)',
  memory: 'User-Memory (persönliche Fakten personalisieren die Antworten)',
  savedQueries: 'Eigene Abfragen speichern (Standardfragen und Antwortfokus je Dashboard)',
};

const isoDate = z.string().refine((s) => !Number.isNaN(Date.parse(s)), 'ISO-8601-Zeitstempel erwartet');

export const licensePayloadSchema = z.object({
  formatVersion: z.literal(LICENSE_FORMAT_VERSION),
  licenseId: z.string().min(1),
  /** Aktuell nur ein Tier — die lizenzlose Basis ist die Open-Core-Edition. */
  tier: z.literal('enterprise'),
  licensee: z.string().min(1),
  issuedAt: isoDate,
  /** Pflicht — es gibt keine unbefristete Lizenz. */
  validUntil: isoDate,
  /** Optional enger als das Tier; weggelassen = alle Features des Tiers. */
  features: z.array(z.enum(EE_FEATURES)).optional(),
});

export type LicensePayload = z.infer<typeof licensePayloadSchema>;

export interface License extends LicensePayload {
  /** Effektive Features (explizite Liste oder alle des Tiers). */
  effectiveFeatures: EeFeature[];
}

export type LicenseStatus =
  | { status: 'none' }
  | { status: 'valid'; license: License }
  | { status: 'expired'; license: License }
  | { status: 'invalid'; reason: string };

export class LicenseFormatError extends Error {}

export function parseLicenseToken(tokenText: string): { payloadJson: string; signature: Buffer } {
  const parts = tokenText.trim().split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new LicenseFormatError('Lizenz-Token muss aus "<payload>.<signature>" bestehen');
  }
  const payloadJson = Buffer.from(parts[0], 'base64url').toString('utf8');
  const signature = Buffer.from(parts[1], 'base64url');
  if (signature.length === 0) throw new LicenseFormatError('Lizenz-Signatur ist leer');
  return { payloadJson, signature };
}

export function encodeLicenseToken(payloadJson: string, signature: Buffer): string {
  return `${Buffer.from(payloadJson, 'utf8').toString('base64url')}.${signature.toString('base64url')}`;
}

/** Nur für Generator/Tests — die Middleware selbst signiert nie. */
export function signLicensePayload(payloadJson: string, privateKey: KeyObject): Buffer {
  return sign(null, Buffer.from(payloadJson, 'utf8'), privateKey);
}

/** Public Key aus rohen 32 Bytes (base64url, wie `keygen` sie ausgibt). */
export function publicKeyFromB64Url(raw: string): KeyObject {
  const bytes = Buffer.from(raw.trim(), 'base64url');
  if (bytes.length !== 32) {
    throw new LicenseFormatError(`Ed25519-Public-Key muss 32 Bytes haben, hat ${bytes.length}`);
  }
  return createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: bytes.toString('base64url') }, format: 'jwk' });
}

export function publicKeyFromPem(pem: string): KeyObject {
  return createPublicKey(pem);
}

export function featuresOf(payload: LicensePayload): EeFeature[] {
  return payload.features ? [...payload.features] : [...EE_FEATURES];
}

export function verifyLicense(tokenText: string, publicKey: KeyObject, now: Date = new Date()): LicenseStatus {
  let parsed: { payloadJson: string; signature: Buffer };
  try {
    parsed = parseLicenseToken(tokenText);
  } catch (err) {
    return { status: 'invalid', reason: err instanceof Error ? err.message : 'Lizenz-Token unlesbar' };
  }
  let signatureOk = false;
  try {
    signatureOk = verify(null, Buffer.from(parsed.payloadJson, 'utf8'), publicKey, parsed.signature);
  } catch {
    signatureOk = false;
  }
  if (!signatureOk) return { status: 'invalid', reason: 'Signatur ungültig (falscher Schlüssel oder manipulierter Token)' };

  let json: unknown;
  try {
    json = JSON.parse(parsed.payloadJson);
  } catch {
    return { status: 'invalid', reason: 'Lizenz-Payload ist kein JSON' };
  }
  const payload = licensePayloadSchema.safeParse(json);
  if (!payload.success) {
    return { status: 'invalid', reason: `Lizenz-Payload ungültig: ${payload.error.issues.map((i) => i.path.join('.') + ' ' + i.message).join('; ')}` };
  }
  const license: License = { ...payload.data, effectiveFeatures: featuresOf(payload.data) };
  if (Date.parse(license.validUntil) < now.getTime()) {
    return { status: 'expired', license };
  }
  return { status: 'valid', license };
}

export function hasFeature(status: LicenseStatus, feature: EeFeature): boolean {
  return status.status === 'valid' && status.license.effectiveFeatures.includes(feature);
}

export interface LicenseEnv {
  OVP_LICENSE?: string;
  OVP_LICENSE_PATH?: string;
  OVP_LICENSE_PUBLIC_KEY_B64URL?: string;
  OVP_LICENSE_PUBLIC_KEY_PATH?: string;
}

/**
 * Liest Lizenz und Public Key aus der Umgebung. Ohne Token → 'none'
 * (Open Core). Token ohne Public Key ist ein Konfigurationsfehler ('invalid').
 */
export function loadLicenseFromEnv(env: LicenseEnv, now: Date = new Date()): LicenseStatus {
  let token = env.OVP_LICENSE?.trim() ?? '';
  if (!token && env.OVP_LICENSE_PATH?.trim()) {
    try {
      token = fs.readFileSync(env.OVP_LICENSE_PATH.trim(), 'utf8').trim();
    } catch (err) {
      return { status: 'invalid', reason: `Lizenzdatei nicht lesbar: ${err instanceof Error ? err.message : String(err)}` };
    }
  }
  if (!token) return { status: 'none' };

  let publicKey: KeyObject;
  try {
    if (env.OVP_LICENSE_PUBLIC_KEY_B64URL?.trim()) {
      publicKey = publicKeyFromB64Url(env.OVP_LICENSE_PUBLIC_KEY_B64URL);
    } else if (env.OVP_LICENSE_PUBLIC_KEY_PATH?.trim()) {
      publicKey = publicKeyFromPem(fs.readFileSync(env.OVP_LICENSE_PUBLIC_KEY_PATH.trim(), 'utf8'));
    } else {
      publicKey = publicKeyFromB64Url(DEFAULT_LICENSE_PUBLIC_KEY_B64URL);
    }
  } catch (err) {
    return { status: 'invalid', reason: `Public Key unlesbar: ${err instanceof Error ? err.message : String(err)}` };
  }
  return verifyLicense(token, publicKey, now);
}

/** Vertrauensanker aus der Umgebung (oder der eingebettete Standard-Key). */
export function trustedPublicKeyFromEnv(env: LicenseEnv): KeyObject {
  if (env.OVP_LICENSE_PUBLIC_KEY_B64URL?.trim()) return publicKeyFromB64Url(env.OVP_LICENSE_PUBLIC_KEY_B64URL);
  if (env.OVP_LICENSE_PUBLIC_KEY_PATH?.trim()) return publicKeyFromPem(fs.readFileSync(env.OVP_LICENSE_PUBLIC_KEY_PATH.trim(), 'utf8'));
  return publicKeyFromB64Url(DEFAULT_LICENSE_PUBLIC_KEY_B64URL);
}

/** Kompakte, loggbare Zusammenfassung (ohne Signatur/Token). */
export function describeLicense(status: LicenseStatus): Record<string, unknown> {
  if (status.status === 'none') return { status: 'none' };
  if (status.status === 'invalid') return { status: 'invalid', reason: status.reason };
  return {
    status: status.status,
    licenseId: status.license.licenseId,
    licensee: status.license.licensee,
    tier: status.license.tier,
    validUntil: status.license.validUntil,
    features: status.license.effectiveFeatures,
  };
}
