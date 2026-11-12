/**
 * Kleiner Router für /api: Methode + Pfadmuster, Zugriffsstufe, Rate-Limit-Gruppe.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ServerConfig } from '../config';
import type { SessionRecord, Store } from '../db';
import type { FileStore } from '../files';
import type { Logger } from '../logger';
import type { MailTransport } from '../mail';

export interface AppContext {
    store: Store;
    files: FileStore;
    config: ServerConfig;
    logger: Logger;
    /** null = Mailversand nicht eingerichtet. */
    mail: MailTransport | null;
    /** Laufende Hintergrund-Versände (Tests warten darauf). */
    background: Set<Promise<void>>;
}

export interface RouteContext {
    app: AppContext;
    req: IncomingMessage;
    res: ServerResponse;
    url: URL;
    params: Record<string, string>;
    /** Body als JSON-Objekt (einmal gelesen). */
    body(): Promise<Record<string, unknown>>;
    /** Gesetzt bei Zugriff 'employee' oder 'admin'. */
    session: SessionRecord | null;
}

/** Rückgabewert eines Handlers, der die Antwort selbst geschrieben hat (Dateien). */
export const HANDLED = Symbol('handled');

/** employee = jede gültige Sitzung (auch Admin), admin = nur Admin. */
export type RouteAccess = 'public' | 'employee' | 'admin';

export interface Route {
    method: 'GET' | 'POST' | 'PUT' | 'DELETE';
    path: string;
    access: RouteAccess;
    limiter?: 'auth' | 'api' | 'upload';
    handler(ctx: RouteContext): Promise<unknown> | unknown;
}

export interface CompiledRoute extends Route {
    regex: RegExp;
    keys: string[];
}

export function compileRoutes(routes: Route[]): CompiledRoute[] {
    return routes.map((route) => {
        const keys: string[] = [];
        const pattern = route.path
            .split('/')
            .map((segment) => {
                if (segment.startsWith(':')) {
                    keys.push(segment.slice(1));
                    return '([^/]+)';
                }
                return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            })
            .join('/');
        return { ...route, regex: new RegExp(`^${pattern}$`), keys };
    });
}
