/**
 * Konsolen-Log: eine JSON-Zeile je Ereignis (`{ at, level, msg, ...felder }`).
 * Keine Passwörter, Secrets oder Tokens übergeben.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

const LEVEL_RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

export type LogFields = Record<string, unknown>;

export interface Logger {
    debug(msg: string, fields?: LogFields): void;
    info(msg: string, fields?: LogFields): void;
    warn(msg: string, fields?: LogFields): void;
    error(msg: string, fields?: LogFields): void;
}

export function isLogLevel(value: unknown): value is LogLevel {
    return typeof value === 'string' && value in LEVEL_RANK;
}

/** Fehlerobjekte serialisierbar machen (JSON.stringify liefert sonst `{}`). */
function normalizeValue(value: unknown): unknown {
    if (value instanceof Error) {
        const out: Record<string, unknown> = { name: value.name, message: value.message };
        const code = (value as { rpcErrorCode?: unknown; code?: unknown }).rpcErrorCode ?? (value as { code?: unknown }).code;
        if (code !== undefined) out.code = code;
        return out;
    }
    return value;
}

export function createLogger(level: LogLevel = 'info'): Logger {
    const min = LEVEL_RANK[level];
    function write(lvl: Exclude<LogLevel, 'silent'>, msg: string, fields?: LogFields): void {
        if (LEVEL_RANK[lvl] < min) return;
        const entry: Record<string, unknown> = { at: new Date().toISOString(), level: lvl, msg };
        if (fields) {
            for (const [key, value] of Object.entries(fields)) {
                if (value !== undefined) entry[key] = normalizeValue(value);
            }
        }
        let line: string;
        try {
            line = JSON.stringify(entry);
        } catch {
            line = JSON.stringify({ at: entry.at, level: lvl, msg });
        }
        if (lvl === 'error' || lvl === 'warn') console.error(line);
        else console.log(line);
    }
    return {
        debug: (msg, fields) => write('debug', msg, fields),
        info: (msg, fields) => write('info', msg, fields),
        warn: (msg, fields) => write('warn', msg, fields),
        error: (msg, fields) => write('error', msg, fields),
    };
}
