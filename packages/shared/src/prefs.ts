/**
 * Vertragsdetails, die der KERN kennen muss, um Anfragen der Extension
 * durchzureichen. Die Fachlichkeit der Personalisierung (Schema der
 * Präferenzen, Fokus-Vorschläge, Fakten-Limits) gehört zur Enterprise-Edition
 * und liegt in ee/server/src/personalization-schema.ts bzw.
 * ee/server/src/personalization-store.ts.
 */

/**
 * Header, über die Extension und Middleware Nutzer und Dashboard benennen —
 * bewusst Header und keine Query-Parameter (keine PII in URLs/Access-Logs).
 */
export const USER_ID_HEADER = 'x-tableau-user';
export const DASHBOARD_KEY_HEADER = 'x-dashboard-key';

/** Längenbegrenzungen der Chat-Anfrage (schemas.ts) und der Header. */
export const MAX_FOCUS_CHARS = 200;
export const MAX_DASHBOARD_KEY_CHARS = 200;
