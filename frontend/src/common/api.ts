/**
 * HTTP-Transport (Muster aus chargepilot-chayns-interface).
 *
 *  - Container-API unter demselben Origin (`/api/...`), Antworthülle `ApiResponse<T>`.
 *  - Anmeldung per `Authorization: Bearer <sessionToken>`; die Sitzung liegt im localStorage,
 *    weil die Seite als iFrame in chayns läuft (Drittanbieter-Cookies unzuverlässig).
 *  - chayns.codes-Bridge wird nur vom Browser mit dem chayns-Access-Token aufgerufen.
 */
import { getAccessToken } from 'chayns-api';
import {
    ERROR_MESSAGES_DE,
    SESSION_STORAGE_KEY,
    type ApiError,
    type ApiResponse,
    type ErrorCode,
    type SessionResponse,
} from '../../../shared/contract';

/** Basis-URL; leer = gleicher Origin. Für lokale Tests über window.__BTB_CONFIG__.apiBase änderbar. */
const API_BASE = (() => {
    const raw = (window as unknown as { __BTB_CONFIG__?: { apiBase?: unknown } }).__BTB_CONFIG__?.apiBase;
    return typeof raw === 'string' ? raw.replace(/\/+$/, '') : '';
})();

export function apiUrl(path: string): string {
    return `${API_BASE}${path}`;
}

export class ApiClientError extends Error {
    readonly code: ErrorCode;
    readonly fields: string[] | undefined;

    constructor(error: ApiError) {
        super(error.message || ERROR_MESSAGES_DE[error.code] || ERROR_MESSAGES_DE.INTERNAL_ERROR);
        this.name = 'ApiClientError';
        this.code = error.code;
        this.fields = error.fields;
    }
}

export function getErrorMessage(error: unknown): string {
    if (error instanceof ApiClientError) return error.message;
    if (error instanceof TypeError) return 'Keine Verbindung zum Server. Bitte die Internetverbindung prüfen.';
    if (error instanceof Error && error.message) return error.message;
    return ERROR_MESSAGES_DE.INTERNAL_ERROR;
}

export function isAuthError(error: unknown): boolean {
    return error instanceof ApiClientError && (error.code === 'NOT_AUTHENTICATED' || error.code === 'SESSION_EXPIRED');
}

export async function resolveAccessToken(): Promise<string | undefined> {
    try {
        const result = await getAccessToken();
        return result?.accessToken || undefined;
    } catch {
        return undefined;
    }
}

// Sitzung -------------------------------------------------------------------

let memorySession: SessionResponse | null = null;
const authLostListeners = new Set<() => void>();

function isUsable(session: SessionResponse | null): session is SessionResponse {
    return !!session && !!session.token && Date.parse(session.expiresAt) > Date.now();
}

export function getSession(): SessionResponse | null {
    if (isUsable(memorySession)) return memorySession;
    try {
        const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
        if (!raw) return null;
        const stored = JSON.parse(raw) as SessionResponse;
        if (!isUsable(stored)) {
            window.localStorage.removeItem(SESSION_STORAGE_KEY);
            return null;
        }
        memorySession = stored;
        return stored;
    } catch {
        return null;
    }
}

export function storeSession(session: SessionResponse): void {
    memorySession = session;
    try {
        window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
    } catch {
        // Ohne Speicher gilt die Sitzung nur bis zum Neuladen.
    }
}

export function clearSession(): void {
    memorySession = null;
    try {
        window.localStorage.removeItem(SESSION_STORAGE_KEY);
    } catch {
        // ignorieren
    }
}

export function onAuthLost(listener: () => void): () => void {
    authLostListeners.add(listener);
    return () => {
        authLostListeners.delete(listener);
    };
}

function handleAuthLost(): void {
    clearSession();
    for (const listener of authLostListeners) listener();
}

// Transport -----------------------------------------------------------------

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

function unwrap<T>(json: unknown, status: number): T {
    // chayns.codes liefert das Rückgabeobjekt der Funktion ({ status, body }); der Container direkt die Hülle.
    const body = (
        json && typeof json === 'object' && 'body' in json && !('ok' in json) ? (json as { body: unknown }).body : json
    ) as ApiResponse<T> | null;
    if (!body || typeof body !== 'object' || !('ok' in body)) {
        const code: ErrorCode =
            status === 401 ? 'NOT_AUTHENTICATED' : status === 403 ? 'FORBIDDEN' : status === 413 ? 'PAYLOAD_TOO_LARGE' : 'INTERNAL_ERROR';
        throw new ApiClientError({ code, message: ERROR_MESSAGES_DE[code] });
    }
    if (body.ok) return body.data;
    throw new ApiClientError(body.error);
}

async function rawRequest<T>(url: string, method: HttpMethod, body?: unknown, bearer?: string, signal?: AbortSignal): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (bearer) headers.Authorization = `Bearer ${bearer}`;
    const response = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal });
    let json: unknown = null;
    try {
        json = await response.json();
    } catch {
        json = null;
    }
    return unwrap<T>(json, response.status);
}

export function publicRequest<T>(method: HttpMethod, path: string, body?: unknown): Promise<T> {
    return rawRequest<T>(apiUrl(path), method, body);
}

function requireToken(): string {
    const session = getSession();
    if (!session) {
        handleAuthLost();
        throw new ApiClientError({ code: 'NOT_AUTHENTICATED', message: ERROR_MESSAGES_DE.NOT_AUTHENTICATED });
    }
    return session.token;
}

export async function authRequest<T>(method: HttpMethod, path: string, body?: unknown): Promise<T> {
    const token = requireToken();
    try {
        return await rawRequest<T>(apiUrl(path), method, body, token);
    } catch (err) {
        if (isAuthError(err)) handleAuthLost();
        throw err;
    }
}

/** Binäres Upload-Stück (PUT, application/octet-stream). */
export async function uploadChunk(path: string, chunk: Blob): Promise<{ received: number }> {
    const token = requireToken();
    const response = await fetch(apiUrl(path), {
        method: 'PUT',
        headers: { Accept: 'application/json', 'Content-Type': 'application/octet-stream', Authorization: `Bearer ${token}` },
        body: chunk,
    });
    let json: unknown = null;
    try {
        json = await response.json();
    } catch {
        json = null;
    }
    try {
        return unwrap<{ received: number }>(json, response.status);
    } catch (err) {
        if (isAuthError(err)) handleAuthLost();
        throw err;
    }
}

/** Datei mit Sitzung laden (Links können keinen Authorization-Header senden). */
export async function fetchBlob(path: string): Promise<Blob> {
    const token = requireToken();
    const response = await fetch(apiUrl(path), { headers: { Authorization: `Bearer ${token}` } });
    const contentType = response.headers.get('Content-Type') ?? '';
    if (!response.ok || contentType.includes('application/json')) {
        let json: unknown = null;
        try {
            json = await response.json();
        } catch {
            json = null;
        }
        try {
            unwrap(json, response.status);
        } catch (err) {
            if (isAuthError(err)) handleAuthLost();
            throw err;
        }
        throw new ApiClientError({ code: 'INTERNAL_ERROR', message: ERROR_MESSAGES_DE.INTERNAL_ERROR });
    }
    return response.blob();
}

/** Ruft die chayns.codes-Bridge mit dem chayns-Token auf. */
export async function callBridge<T>(bridgeUrl: string, action: string, payload?: unknown, signal?: AbortSignal): Promise<T> {
    const token = await resolveAccessToken();
    if (!token) throw new ApiClientError({ code: 'NOT_AUTHENTICATED', message: ERROR_MESSAGES_DE.NOT_AUTHENTICATED });
    return rawRequest<T>(bridgeUrl, 'POST', { action, payload }, token, signal);
}
