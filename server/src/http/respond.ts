/**
 * Antworten, Body-Verarbeitung und Fehlerabbildung. Hülle `ApiResponse` plus HTTP-Status.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Readable } from 'node:stream';
import { ErrorCodes, type ApiResponse, type ErrorCode } from '../../../shared/contract';
import { ApiFailure, toApiError } from '../errors';
import type { Logger } from '../logger';

/** JSON-Bodys: Bericht inkl. zwei Unterschriften (PNG) bleibt deutlich darunter. */
export const MAX_JSON_BYTES = 900_000;

export const STATUS_BY_CODE: Record<ErrorCode, number> = {
    VALIDATION_ERROR: 400,
    NOT_AUTHENTICATED: 401,
    SESSION_EXPIRED: 401,
    FORBIDDEN: 403,
    NOT_FOUND: 404,
    CONFLICT: 409,
    BRIDGE_REJECTED: 403,
    RATE_LIMITED: 429,
    PAYLOAD_TOO_LARGE: 413,
    AI_FAILED: 502,
    INTERNAL_ERROR: 500,
};

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
    const text = JSON.stringify(body);
    res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(text),
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
    });
    res.end(text);
}

export function sendOk<T>(res: ServerResponse, data: T): void {
    const body: ApiResponse<T> = { ok: true, data };
    sendJson(res, 200, body);
}

export function sendFailure(res: ServerResponse, err: unknown, logger?: Logger): void {
    const error = toApiError(err, logger);
    const body: ApiResponse<never> = { ok: false, error };
    sendJson(res, STATUS_BY_CODE[error.code] ?? 500, body);
}

/** Datei ausliefern (PDF, Foto); `inline` zeigt sie im Browser an. */
export function sendStream(
    res: ServerResponse,
    stream: Readable,
    options: { contentType: string; size: number; fileName: string; inline: boolean },
): void {
    const disposition = options.inline ? 'inline' : 'attachment';
    res.writeHead(200, {
        'Content-Type': options.contentType,
        'Content-Length': options.size,
        'Content-Disposition': `${disposition}; filename="${options.fileName.replace(/[^A-Za-z0-9._-]/g, '_')}"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
    });
    stream.on('error', () => res.destroy()).pipe(res);
}

/** Liest den Body als Buffer. Wirft PAYLOAD_TOO_LARGE oberhalb von `limit`. */
export function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const declared = Number(req.headers['content-length']);
        if (Number.isFinite(declared) && declared > limit) {
            req.resume();
            reject(new ApiFailure(ErrorCodes.PAYLOAD_TOO_LARGE));
            return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        let failed = false;
        req.on('data', (chunk: Buffer) => {
            if (failed) return;
            size += chunk.length;
            if (size > limit) {
                failed = true;
                reject(new ApiFailure(ErrorCodes.PAYLOAD_TOO_LARGE));
                req.resume();
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => {
            if (!failed) resolve(Buffer.concat(chunks));
        });
        req.on('error', (err) => reject(err));
    });
}

export function parseJsonObject(raw: string): Record<string, unknown> {
    if (raw.trim().length === 0) return {};
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        throw new ApiFailure(ErrorCodes.VALIDATION_ERROR, 'Der Anfrageinhalt ist kein gültiges JSON.');
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new ApiFailure(ErrorCodes.VALIDATION_ERROR, 'Der Anfrageinhalt ist kein Objekt.');
    }
    return parsed as Record<string, unknown>;
}

export function clientIp(req: IncomingMessage, trustProxy: boolean): string {
    if (trustProxy) {
        const first = header(req, 'x-forwarded-for')?.split(',')[0]?.trim();
        if (first) return first;
    }
    return req.socket.remoteAddress ?? 'unbekannt';
}

export function header(req: IncomingMessage, name: string): string | undefined {
    const value = req.headers[name.toLowerCase()];
    return Array.isArray(value) ? value[0] : value;
}
