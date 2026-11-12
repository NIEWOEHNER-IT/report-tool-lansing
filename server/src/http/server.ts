/**
 * HTTP-Einstieg: /healthz, /api (Routing, Anmeldung, Rate-Limit) und statische Frontends
 * (Formular unter /, Admin-Bereich unter /admin/).
 *
 * Ein Origin, kein CORS. Absichtlich keine X-Frame-Options (chayns-iFrame).
 */
import type { RequestListener } from 'node:http';
import { ErrorCodes } from '../../../shared/contract';
import { requireSession } from '../auth';
import { ApiFailure } from '../errors';
import { defaultRateLimiters, type RateLimiters } from './rateLimit';
import { clientIp, header, MAX_JSON_BYTES, parseJsonObject, readBody, sendFailure, sendOk } from './respond';
import { compileRoutes, HANDLED, type AppContext, type RouteContext } from './router';
import { authRoutes } from './routes/auth';
import { reportRoutes } from './routes/reports';
import { serveStatic } from './static';

export function createRequestListener(app: AppContext, limiters?: RateLimiters): RequestListener {
    const limit = limiters ?? defaultRateLimiters(app.logger);
    const routes = compileRoutes([...authRoutes, ...reportRoutes]);

    async function handleApi(ctxBase: Omit<RouteContext, 'params' | 'session' | 'body'>): Promise<void> {
        const { req, res, url } = ctxBase;
        const method = (req.method ?? 'GET').toUpperCase();
        const ip = clientIp(req, app.config.trustProxy);
        let matched: { route: (typeof routes)[number]; params: Record<string, string> } | null = null;
        for (const route of routes) {
            if (route.method !== method) continue;
            const match = route.regex.exec(url.pathname);
            if (!match) continue;
            const params: Record<string, string> = {};
            route.keys.forEach((key, index) => {
                try {
                    params[key] = decodeURIComponent(match[index + 1] ?? '');
                } catch {
                    throw new ApiFailure(ErrorCodes.VALIDATION_ERROR, 'Ungültiger Pfad.');
                }
            });
            matched = { route, params };
            break;
        }
        if (!matched) {
            limit.api.check(ip);
            throw new ApiFailure(ErrorCodes.NOT_FOUND, 'Unbekannte Adresse.');
        }
        const { route, params } = matched;
        limit[route.limiter ?? 'api'].check(ip);

        let session = null;
        if (route.access !== 'public') {
            session = requireSession(app.store, header(req, 'authorization'));
            if (route.access === 'admin' && session.role !== 'admin') throw new ApiFailure(ErrorCodes.FORBIDDEN);
        }

        let bodyCache: Record<string, unknown> | null = null;
        const ctx: RouteContext = {
            ...ctxBase,
            params,
            session,
            async body() {
                if (bodyCache === null) bodyCache = parseJsonObject((await readBody(req, MAX_JSON_BYTES)).toString('utf8'));
                return bodyCache;
            },
        };
        const result = await route.handler(ctx);
        if (result === HANDLED) return;
        sendOk(res, result ?? { ok: true });
    }

    return (req, res) => {
        let url: URL;
        try {
            url = new URL(req.url ?? '/', 'http://localhost');
        } catch {
            res.writeHead(400);
            res.end();
            return;
        }
        if (url.pathname === '/healthz') {
            res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
            res.end('ok');
            return;
        }
        if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
            handleApi({ app, req, res, url }).catch((err: unknown) => {
                if (!res.headersSent) {
                    // Nicht gelesene Bodys verwerfen, damit die Verbindung sauber endet.
                    req.resume();
                    sendFailure(res, err, app.logger);
                } else {
                    res.end();
                }
            });
            return;
        }
        serveStatic(app.config.staticDir, url.pathname, req, res);
    };
}
