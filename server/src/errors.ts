/**
 * Einheitliche Fehlerbehandlung der API.
 *
 * Erwartete Fehler werden als `ApiFailure` geworfen und von der HTTP-Schicht in eine
 * `ApiResponse` mit `ok:false` übersetzt. Unerwartete Exceptions werden zu INTERNAL_ERROR;
 * Details bleiben im Server-Log.
 */
import { ERROR_MESSAGES_DE, ErrorCodes, type ApiError, type ErrorCode } from '../../shared/contract';
import type { Logger } from './logger';

export class ApiFailure extends Error {
    readonly code: ErrorCode;
    readonly fields?: string[];

    constructor(code: ErrorCode, message?: string, fields?: string[]) {
        super(message ?? ERROR_MESSAGES_DE[code]);
        this.name = 'ApiFailure';
        this.code = code;
        this.fields = fields;
    }
}

/** Wandelt eine beliebige Exception in ein clientsicheres ApiError-Objekt um. */
export function toApiError(err: unknown, logger?: Logger): ApiError {
    if (err instanceof ApiFailure) {
        const error: ApiError = { code: err.code, message: err.message };
        if (err.fields) error.fields = err.fields;
        return error;
    }
    logger?.error('api.unexpected_error', { error: err, stack: err instanceof Error ? err.stack : undefined });
    return { code: ErrorCodes.INTERNAL_ERROR, message: ERROR_MESSAGES_DE.INTERNAL_ERROR };
}

/** Kurzer Text eines beliebigen Fehlers (für Protokoll und lastError). */
export function errorText(err: unknown): string {
    if (err instanceof Error) {
        const code = (err as { rpcErrorCode?: unknown }).rpcErrorCode;
        return typeof code === 'string' && code ? `${code}: ${err.message}` : err.message || err.name;
    }
    if (typeof err === 'string') return err;
    try {
        return JSON.stringify(err);
    } catch {
        return String(err);
    }
}
