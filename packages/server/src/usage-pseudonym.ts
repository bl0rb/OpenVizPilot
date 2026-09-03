import { createHmac, randomBytes } from 'node:crypto';

/**
 * Pseudonyme für die Dashboard-Nutzungsstatistik ("wie viele Anwender, wie
 * viele Fragen pro Anwender" — OHNE Namen oder Tableau-IDs zu speichern).
 *
 * Die obfuskierte Tableau-User-ID wird mit einem geheimen, pro Installation
 * einmalig erzeugten Salt (DB-Singleton, damit alle Replicas dasselbe
 * Pseudonym bilden) per HMAC-SHA256 gehasht und gekürzt. Das Pseudonym ist
 * stabil (Zählung "pro Anwender" über Tage hinweg möglich), aber ohne den
 * Salt nicht auf die ID zurückführbar — und bewusst NICHT mit dem User-Memory
 * verknüpfbar, das unter der Roh-ID gespeichert ist.
 */

export const USAGE_PSEUDONYM_CHARS = 32;

export function generateUsageSalt(): string {
  return randomBytes(32).toString('hex');
}

export function pseudonymizeUser(salt: string, userId: string): string {
  return createHmac('sha256', salt).update(userId).digest('hex').slice(0, USAGE_PSEUDONYM_CHARS);
}
