/**
 * Auslieferung des gebauten Frontends:
 *  - "/" liefert index.html, es gibt keine clientseitigen Routen;
 *  - versteckte Dateien nie ausliefern, kein Pfad außerhalb von staticDir;
 *  - `Cache-Control: no-cache` mit ETag, damit neue Builds sofort greifen;
 *  - keine X-Frame-Options: chayns bettet die Seite im iFrame ein.
 */
import { createReadStream, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';

const CONTENT_TYPES: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.mjs': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.ico': 'image/x-icon',
    '.webp': 'image/webp',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.txt': 'text/plain; charset=utf-8',
    '.map': 'application/json; charset=utf-8',
};

function etagFor(size: number, mtimeMs: number): string {
    return `"${size.toString(16)}-${Math.floor(mtimeMs).toString(16)}"`;
}

function notFound(res: ServerResponse): void {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' });
    res.end('Nicht gefunden');
}

export function serveStatic(staticDir: string, pathname: string, req: IncomingMessage, res: ServerResponse): void {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { Allow: 'GET, HEAD' });
        res.end();
        return;
    }
    const root = resolve(staticDir);
    let relative: string;
    try {
        // Verzeichnisse (/ und /admin/) liefern ihre index.html.
        const decoded = decodeURIComponent(pathname === '/admin' ? '/admin/' : pathname);
        relative = (decoded.endsWith('/') ? `${decoded}index.html` : decoded).replace(/^\/+/, '');
    } catch {
        notFound(res);
        return;
    }
    if (relative.includes('\0') || relative.split(/[\\/]/).some((segment) => segment.startsWith('.'))) {
        notFound(res);
        return;
    }
    const filePath = resolve(join(root, relative));
    if (filePath !== root && !filePath.startsWith(root + sep)) {
        notFound(res);
        return;
    }
    let stats;
    try {
        stats = statSync(filePath);
    } catch {
        notFound(res);
        return;
    }
    if (!stats.isFile()) {
        notFound(res);
        return;
    }
    const etag = etagFor(stats.size, stats.mtimeMs);
    const headers: Record<string, string | number> = {
        'Content-Type': CONTENT_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream',
        'Cache-Control': 'no-cache',
        ETag: etag,
        'X-Content-Type-Options': 'nosniff',
    };
    if (req.headers['if-none-match'] === etag) {
        res.writeHead(304, headers);
        res.end();
        return;
    }
    headers['Content-Length'] = stats.size;
    res.writeHead(200, headers);
    if (req.method === 'HEAD') {
        res.end();
        return;
    }
    createReadStream(filePath)
        .on('error', () => res.destroy())
        .pipe(res);
}
