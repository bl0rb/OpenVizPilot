/**
 * Minimaler Metadaten-Logger.
 *
 * DATENSCHUTZ-REGEL: Es werden NIE Nachrichteninhalte, Kontext-Snapshots oder
 * Tool-Ergebnisse geloggt — nur Metadaten (Modell, Dauer, Token, Fehlerklasse).
 * Dashboard-Daten dürfen nicht in Server-Logs landen.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

export interface Logger {
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

export function createLogger(level: LogLevel): Logger {
  const min = ORDER[level];
  const log = (lvl: LogLevel, msg: string, meta?: Record<string, unknown>) => {
    if (ORDER[lvl] < min) return;
    const line = `${new Date().toISOString()} [${lvl.toUpperCase()}] ${msg}${
      meta && Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : ''
    }`;
    if (lvl === 'error') console.error(line);
    else if (lvl === 'warn') console.warn(line);
    else console.log(line);
  };
  return {
    debug: (m, meta) => log('debug', m, meta),
    info: (m, meta) => log('info', m, meta),
    warn: (m, meta) => log('warn', m, meta),
    error: (m, meta) => log('error', m, meta),
  };
}
