/**
 * Zusammenbau: Datenbank, Dateiablage, HTTP-Server, Aufräum-Job.
 */
import { createServer, type Server } from 'node:http';
import { mkdirSync } from 'node:fs';
import {
    CLEANUP_INTERVAL_MS,
    INCOMPLETE_UPLOAD_TTL_HOURS,
    MAIL_MAX_ATTEMPTS,
    MAIL_RETRY_AFTER_MINUTES,
    MAIL_RETRY_INTERVAL_MS,
    type ServerConfig,
} from './config';
import { openDatabase, Store } from './db';
import { FileStore } from './files';
import { createRequestListener } from './http/server';
import type { RateLimiters } from './http/rateLimit';
import type { AppContext } from './http/router';
import { createLogger, type Logger } from './logger';
import { createSmtpTransport, deliverReportMail, type MailTransport } from './mail';
import { nowIso } from './random';

export interface App {
    context: AppContext;
    server: Server;
    start(): Promise<number>;
    stop(): Promise<void>;
    cleanup(): Promise<void>;
    retryMails(): Promise<void>;
}

export function createApp(
    config: ServerConfig,
    options: { logger?: Logger; limiters?: RateLimiters; mailTransport?: MailTransport | null } = {},
): App {
    const logger = options.logger ?? createLogger(config.logLevel);
    if (config.dbPath !== ':memory:') mkdirSync(config.dataDir, { recursive: true });
    const db = openDatabase(config.dbPath);
    const store = new Store(db);
    const files = new FileStore(config.dataDir);
    const mail = options.mailTransport !== undefined ? options.mailTransport : config.smtp ? createSmtpTransport(config.smtp) : null;
    const context: AppContext = { store, files, config, logger, mail, background: new Set() };
    const server = createServer(createRequestListener(context, options.limiters));
    // Uploads über mobile Verbindungen dürfen dauern; Kopfzeilen müssen trotzdem zügig kommen.
    server.requestTimeout = 120_000;
    server.headersTimeout = 30_000;
    let timer: NodeJS.Timeout | null = null;
    let mailTimer: NodeJS.Timeout | null = null;

    async function retryMails(): Promise<void> {
        if (!mail) return;
        const triedBefore = new Date(Date.now() - MAIL_RETRY_AFTER_MINUTES * 60_000).toISOString();
        for (const report of store.listMailRetries(MAIL_MAX_ATTEMPTS, triedBefore)) {
            await deliverReportMail({ store, files, logger, smtp: config.smtp, transport: mail }, report);
        }
    }

    async function cleanup(): Promise<void> {
        const now = nowIso();
        store.purgeExpired(now);
        const before = new Date(Date.now() - INCOMPLETE_UPLOAD_TTL_HOURS * 3_600_000).toISOString();
        for (const report of store.listStaleUploads(before)) {
            store.deleteReport(report.id);
            await files.removeReport(report.id);
            logger.info('report.stale_upload_removed', { id: report.id });
        }
    }

    return {
        context,
        server,
        cleanup,
        retryMails,
        start() {
            return new Promise((resolve, reject) => {
                server.once('error', reject);
                server.listen(config.port, config.host || undefined, () => {
                    const address = server.address();
                    const port = typeof address === 'object' && address ? address.port : config.port;
                    logger.info('server.started', { port, dataDir: config.dataDir });
                    timer = setInterval(() => {
                        cleanup().catch((err: unknown) => logger.error('cleanup.failed', { error: err }));
                    }, CLEANUP_INTERVAL_MS);
                    timer.unref();
                    void cleanup().catch((err: unknown) => logger.error('cleanup.failed', { error: err }));
                    mailTimer = setInterval(() => {
                        retryMails().catch((err: unknown) => logger.error('mail.retry_failed', { error: err }));
                    }, MAIL_RETRY_INTERVAL_MS);
                    mailTimer.unref();
                    resolve(port);
                });
            });
        },
        stop() {
            if (timer) clearInterval(timer);
            if (mailTimer) clearInterval(mailTimer);
            return new Promise((resolve) => {
                server.close(() => {
                    db.close();
                    resolve();
                });
                server.closeAllConnections();
            });
        },
    };
}
