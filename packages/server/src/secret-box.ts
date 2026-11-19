import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';

/**
 * Verschlüsselung für in der Admin-UI gespeicherte Core-Secrets (aktuell: API-Key des
 * LLM-Endpunkts). Gleiches Format wie die Tableau-Secrets der Enterprise-Edition:
 * AES-256-GCM, Schlüssel = SHA-256 von `OVP_SECRET_KEY`. Ohne diesen Schlüssel wird
 * nichts im Klartext gespeichert — Aufrufer lehnen das Speichern dann ab. Klartext
 * nie loggen und nie über eine GET-Route zurückgeben.
 */

const ENV_VAR = 'OVP_SECRET_KEY';
const GCM_IV_BYTES = 12;

export const encryptedSecretSchema = z.object({
  v: z.literal(1),
  iv: z.string().min(1),
  tag: z.string().min(1),
  data: z.string().min(1),
});
export type EncryptedSecret = z.infer<typeof encryptedSecretSchema>;

export class SecretBoxError extends Error {
  constructor(readonly code: 'secret_key_missing' | 'secret_invalid') {
    super(code);
    this.name = 'SecretBoxError';
  }
}

function secretKey(env: NodeJS.ProcessEnv): Buffer {
  const raw = env[ENV_VAR];
  if (typeof raw !== 'string' || raw.length < 32) throw new SecretBoxError('secret_key_missing');
  return createHash('sha256').update(raw, 'utf8').digest();
}

export function isSecretKeyConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env[ENV_VAR];
  return typeof raw === 'string' && raw.length >= 32;
}

export function encryptSecret(plain: string, env: NodeJS.ProcessEnv = process.env): EncryptedSecret {
  const key = secretKey(env);
  const iv = randomBytes(GCM_IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return { v: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
}

export function decryptSecret(box: EncryptedSecret, env: NodeJS.ProcessEnv = process.env): string {
  const key = secretKey(env);
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(box.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(box.tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(box.data, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    throw new SecretBoxError('secret_invalid');
  }
}
