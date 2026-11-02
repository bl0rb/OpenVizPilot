/**
 * Statischer Demo-Modus (`vite --mode demo` bzw. VITE_DEMO=1): Die Extension
 * läuft ohne Middleware. Alle /api/*-Aufrufe beantwortet ein lokaler Responder
 * im Browser (siehe demo-backend.ts) — kein Byte verlässt den Tableau-iframe.
 */
export const IS_DEMO = import.meta.env.MODE === 'demo' || import.meta.env.VITE_DEMO === '1';
