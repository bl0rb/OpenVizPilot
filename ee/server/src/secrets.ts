import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * Verschlüsselung für im Web gespeicherte Secrets (aktuell: Tableau Connected-App-Secrets,
 * siehe tableau-server/config.ts). AES-256-GCM; der Schlüssel ist SHA-256 von `OVP_SECRET_KEY`
 * (Env, optional — siehe packages/server/src/env.ts). Der Klartext verlässt diese Datei nie über
 * eine Log-Zeile; Aufrufer dürfen ihn ebenfalls nie loggen oder über eine GET-Route zurückgeben.
 */

const ENV_VAR = 'OVP_SECRET_KEY';
const GCM_IV_BYTES = 12;

export type SecretsErrorCode = 'secret_key_missing' | 'secret_invalid';

export class SecretsError extends Error {
  constructor(readonly code: SecretsErrorCode) {
    super(code);
    this.name = 'SecretsError';
  }
}

export interface EncryptedSecret {
  v: 1;
  /** Base64. */
  iv: string;
  /** Base64, GCM-Auth-Tag. */
  tag: string;
  /** Base64, Chiffrat. */
  data: string;
}

function secretKey(env: NodeJS.ProcessEnv): Buffer {
  const raw = env[ENV_VAR];
  if (typeof raw !== 'string' || raw.length < 32) throw new SecretsError('secret_key_missing');
  return createHash('sha256').update(raw, 'utf8').digest();
}

/** Ohne Aufruf der eigentlichen Ver-/Entschlüsselung prüfbar — für Statusanzeigen in der Admin-UI. */
export function isSecretKeyConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env[ENV_VAR];
  return typeof raw === 'string' && raw.length >= 32;
}

export function encryptSecret(plain: string, env: NodeJS.ProcessEnv = process.env): EncryptedSecret {
  const key = secretKey(env);
  const iv = randomBytes(GCM_IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { v: 1, iv: iv.toString('base64'), tag: tag.toString('base64'), data: data.toString('base64') };
}

export function decryptSecret(box: EncryptedSecret, env: NodeJS.ProcessEnv = process.env): string {
  const key = secretKey(env);
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(box.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(box.tag, 'base64'));
    const plain = Buffer.concat([decipher.update(Buffer.from(box.data, 'base64')), decipher.final()]);
    return plain.toString('utf8');
  } catch (error) {
    if (error instanceof SecretsError) throw error;
    throw new SecretsError('secret_invalid');
  }
}
