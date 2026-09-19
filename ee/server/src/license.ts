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
 * base64url-String). Vertrauensanker sind die eingebetteten Public Keys in
 * TRUSTED_LICENSE_KEYS (kid → Ed25519-Public-Key) — sie sind öffentlich,
 * verraten nichts und machen Lizenzen des WerkWorks-Lizenzgenerators ohne
 * weitere Konfiguration gültig. Schlüsselrotation heißt: neuer Eintrag in
 * TRUSTED_LICENSE_KEYS in einem Release — NIE per Env, Datei oder DB/Admin-UI,
 * sonst könnte sich ein Betreiber mit eigenem Schlüsselpaar selbst Lizenzen
 * ausstellen.
 *
 * Open-Core-Grundzustand ist "keine Lizenz": Alle Kernfunktionen laufen
 * ohne Token; die Enterprise-Features (siehe EE_FEATURES) verlangen eine
 * gültige, nicht abgelaufene Lizenz mit dem passenden Schlüssel.
 */

export const LICENSE_FORMAT_VERSION = 'openvizpilot-license-v1';

/** kid der bisherigen (einzigen) Lizenzgenerator-Lizenz — Tokens ohne `kid`. */
export const DEFAULT_LICENSE_KID = 'werkworks-2026';

/**
 * Eingebettete Vertrauensanker: kid → Ed25519-Public-Key des WerkWorks-
 * Lizenzgenerators (rohe 32 Bytes, base64url). Rotation = neuer Eintrag in
 * einem Release, nie per Env/Datei/DB.
 */
export const TRUSTED_LICENSE_KEYS: Record<string, string> = {
  'werkworks-2026': 'NFitkQQZAptFWMB-YAdHzrMzkO9p76ljOdWrQROUFF4',
};

/** Enterprise-Feature-Schlüssel — müssen im Lizenzgenerator identisch heißen. */
export const EE_FEATURES = ['sso', 'memory', 'savedQueries', 'mcp', 'actions', 'tableauServer'] as const;
export type EeFeature = (typeof EE_FEATURES)[number];

export const EE_FEATURE_LABELS: Record<EeFeature, string> = {
  sso: 'Single Sign-On (OIDC: Microsoft Entra ID, Keycloak)',
  memory: 'User-Memory (persönliche Fakten personalisieren die Antworten)',
  savedQueries: 'Eigene Abfragen speichern (Standardfragen und Antwortfokus je Dashboard)',
  mcp: 'MCP-Quellen und Websuche (Site-Freigaben und zentrale Verwaltung)',
  actions: 'Dashboard-Aktionen aus dem Chat (Filter setzen, Parameter, Markieren, Bereich ein-/ausblenden)',
  tableauServer: 'Tableau Server Connector (Content-Suche und Metadaten)',
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
  /** Welcher Vertrauensanker (TRUSTED_LICENSE_KEYS) die Lizenz signiert hat; fehlt = DEFAULT_LICENSE_KID (bisherige Lizenzen). */
  kid: z.string().min(1).max(64).optional(),
});

export type LicensePayload = z.infer<typeof licensePayloadSchema>;

export interface License extends LicensePayload {
  /** Effektive Features (explizite Liste oder alle des Tiers). */
  effectiveFeatures: EeFeature[];
  /** Aufgelöster Vertrauensanker — bei Tokens ohne eigenes `kid` DEFAULT_LICENSE_KID. */
  kid: string;
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

/**
 * Prüft einen Lizenz-Token gegen die eingebetteten Vertrauensanker.
 *
 * `keys` (Standard: TRUSTED_LICENSE_KEYS) ordnet `kid` → Ed25519-Public-Key
 * (rohe 32 Bytes, base64url) zu. Der `kid` steht — wie bei einem JWT-Header —
 * im (noch unverifizierten) Payload und wählt nur, welcher Schlüssel die
 * Signatur prüft; er verändert selbst nichts an der Lizenz. Fehlt `kid`
 * (alle bisher ausgestellten Tokens), gilt DEFAULT_LICENSE_KID. Ein
 * unbekannter `kid` ist immer ungültig — die eigentliche Ed25519-Prüfung
 * bleibt unverändert, nur die Schlüsselauswahl davor ist neu.
 *
 * `keys` ist ausschließlich für Tests gedacht (eigener Vertrauensanker ohne
 * TRUSTED_LICENSE_KEYS zu berühren) — kein Aufrufer darf ihn aus Env, Datei
 * oder DB befüllen.
 */
export function verifyLicense(tokenText: string, keys: Record<string, string> = TRUSTED_LICENSE_KEYS, now: Date = new Date()): LicenseStatus {
  let parsed: { payloadJson: string; signature: Buffer };
  try {
    parsed = parseLicenseToken(tokenText);
  } catch (err) {
    return { status: 'invalid', reason: err instanceof Error ? err.message : 'Lizenz-Token unlesbar' };
  }

  let json: unknown;
  try {
    json = JSON.parse(parsed.payloadJson);
  } catch {
    return { status: 'invalid', reason: 'Lizenz-Payload ist kein JSON' };
  }

  const rawKid = json && typeof json === 'object' && 'kid' in json ? (json as { kid?: unknown }).kid : undefined;
  const kid = typeof rawKid === 'string' && rawKid ? rawKid : DEFAULT_LICENSE_KID;
  const keyB64url = keys[kid];
  if (!keyB64url) return { status: 'invalid', reason: `unbekannter Signaturschlüssel ${kid}` };

  let publicKey: KeyObject;
  try {
    publicKey = publicKeyFromB64Url(keyB64url);
  } catch (err) {
    return { status: 'invalid', reason: `Public Key unlesbar: ${err instanceof Error ? err.message : String(err)}` };
  }

  let signatureOk = false;
  try {
    signatureOk = verify(null, Buffer.from(parsed.payloadJson, 'utf8'), publicKey, parsed.signature);
  } catch {
    signatureOk = false;
  }
  if (!signatureOk) return { status: 'invalid', reason: 'Signatur ungültig (falscher Schlüssel oder manipulierter Token)' };

  const payload = licensePayloadSchema.safeParse(json);
  if (!payload.success) {
    return { status: 'invalid', reason: `Lizenz-Payload ungültig: ${payload.error.issues.map((i) => i.path.join('.') + ' ' + i.message).join('; ')}` };
  }
  const license: License = { ...payload.data, kid, effectiveFeatures: featuresOf(payload.data) };
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
}

/**
 * Der rohe Lizenz-Token aus der Umgebung — aus `OVP_LICENSE` oder der Datei
 * unter `OVP_LICENSE_PATH`. Beide Wege müssen denselben Token liefern: Wer nur
 * die Datei mountet, hat sonst zwar eine gültige Lizenz, aber keinen Token für
 * alles, was ihn braucht.
 */
export function readLicenseTokenFromEnv(env: LicenseEnv): { token: string | null; error: string | null } {
  const inline = env.OVP_LICENSE?.trim();
  if (inline) return { token: inline, error: null };

  const path = env.OVP_LICENSE_PATH?.trim();
  if (!path) return { token: null, error: null };
  try {
    return { token: fs.readFileSync(path, 'utf8').trim() || null, error: null };
  } catch (err) {
    return { token: null, error: `Lizenzdatei nicht lesbar: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/**
 * Liest Lizenz aus der Umgebung und prüft sie gegen die eingebetteten
 * Vertrauensanker. Ohne Token → 'none' (Open Core). `options.trustedKeys` ist
 * ausschließlich für Tests — nicht aus Env/Datei/DB befüllbar.
 */
export function loadLicenseFromEnv(env: LicenseEnv, options?: { trustedKeys?: Record<string, string>; now?: Date }): LicenseStatus {
  const { token, error } = readLicenseTokenFromEnv(env);
  if (error) return { status: 'invalid', reason: error };
  if (!token) return { status: 'none' };
  return verifyLicense(token, options?.trustedKeys, options?.now);
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
    kid: status.license.kid,
  };
}
