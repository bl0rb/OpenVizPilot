import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

/**
 * Passwort- und Session-Helfer für die Admin-UI im Passwort-Modus
 * (Ersteinrichtung beim ersten Zugriff, Muster wie in PaddleDoc):
 *
 * - Passwörter als scrypt-Hash (node:crypto, keine zusätzliche Dependency)
 *   im selbstbeschreibenden Format `scrypt$N$r$p$salt$hash` — Parameter
 *   stehen im Hash, damit sie später erhöht werden können, ohne bestehende
 *   Konten zu brechen.
 * - Sessions als Zufallstoken; in der DB liegt NUR der SHA-256-Hash des
 *   Tokens (ein DB-Leak gibt keine gültigen Tokens her). DB-basiert, damit
 *   Logins über alle Replicas funktionieren (HPA).
 */

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

export const MIN_ADMIN_PASSWORD_CHARS = 12;
export const ADMIN_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
export const LOGIN_MAX_FAILED_ATTEMPTS = 5;
export const LOGIN_FAILURE_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_LOCKOUT_MS = 15 * 60 * 1000;

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 64;
// N * r * 256 wären ~33 MB; großzügige Obergrenze, damit künftige Parameter passen.
const SCRYPT_MAXMEM = 128 * 1024 * 1024;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: SCRYPT_MAXMEM,
  });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('hex')}$${derived.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, nRaw, rRaw, pRaw, saltHex, hashHex] = parts;
  const N = Number(nRaw);
  const r = Number(rRaw);
  const p = Number(pRaw);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  const expected = Buffer.from(hashHex!, 'hex');
  if (expected.length !== SCRYPT_KEYLEN) return false;
  try {
    const derived = await scrypt(password, Buffer.from(saltHex!, 'hex'), expected.length, {
      N,
      r,
      p,
      maxmem: SCRYPT_MAXMEM,
    });
    return timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

export function newSessionToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('hex');
  return { token, tokenHash: hashSessionToken(token) };
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
