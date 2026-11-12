/**
 * Start des Containers. Beendet sich sauber bei SIGTERM/SIGINT.
 */
import { createApp } from './app';
import { loadConfig } from './config';
import { createLogger } from './logger';

const config = loadConfig();
const logger = createLogger(config.logLevel);

if (!config.bridgeSecret) logger.warn('config.bridge_secret_missing', { note: 'Anmeldung über chayns deaktiviert (BRIDGE_SECRET leer)' });
if (!config.bridgeUrl) logger.warn('config.bridge_url_missing', { note: 'BRIDGE_URL leer: Frontend kann sich nicht anmelden' });
if (config.devLogin) logger.warn('config.dev_login', { note: 'DEV_LOGIN aktiv - nur für lokale Tests!' });
logger.info('config.groups', { team: config.teamGroupIds, admin: config.adminGroupIds });
logger.info('config.mail', config.smtp
    ? { enabled: true, host: config.smtp.host, port: config.smtp.port, from: config.smtp.from, replyTo: config.smtp.replyTo || null }
    : { enabled: false, note: 'SMTP_HOST oder Absender fehlt - E-Mail-Kopie aus' });

const app = createApp(config, { logger });

app.start().catch((err: unknown) => {
    logger.error('server.start_failed', { error: err });
    process.exit(1);
});

let stopping = false;
function shutdown(signal: string): void {
    if (stopping) return;
    stopping = true;
    logger.info('server.stopping', { signal });
    setTimeout(() => process.exit(0), 5000).unref();
    app.stop()
        .then(() => process.exit(0))
        .catch((err: unknown) => {
            logger.error('server.stop_failed', { error: err });
            process.exit(1);
        });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (reason: unknown) => logger.error('process.unhandled_rejection', { error: reason }));
process.on('uncaughtException', (err: Error) => logger.error('process.uncaught_exception', { error: err, stack: err.stack }));
