/**
 * Umgebungsvariablen und feste Betriebswerte.
 */
import { CHAYNS_MANAGER_GROUP, DEFAULT_UAC_GROUP_ADMIN, DEFAULT_UAC_GROUP_TEAM } from '../../shared/contract';
import { isLogLevel, type LogLevel } from './logger';

/** Gültigkeit einer Sitzung (ein Arbeitstag). */
export const SESSION_TTL_HOURS = 12;
/** Gültigkeit einer Nonce für die Bridge-Bestätigung. */
export const CHALLENGE_TTL_MINUTES = 5;
/** Unvollständige Uploads werden nach so vielen Stunden gelöscht. */
export const INCOMPLETE_UPLOAD_TTL_HOURS = 48;
/** Aufräum-Job: Intervall. */
export const CLEANUP_INTERVAL_MS = 60 * 60_000;
/** Größte Datei eines Berichts (PDF mit vielen Fotos). */
export const MAX_FILE_BYTES = 80 * 1024 * 1024;
/** Größter Zeitraum einer Admin-Abfrage. */
export const MAX_RANGE_DAYS = 400;

export interface ServerConfig {
    port: number;
    host: string;
    /** Verzeichnis für SQLite-Datei und Berichtsdateien (Volume). */
    dataDir: string;
    /** ':memory:' in Tests, sonst <dataDir>/bautagesbericht.db */
    dbPath: string;
    staticDir: string;
    trustProxy: boolean;
    bridgeUrl: string;
    bridgeSecret: string;
    /** Gruppen mit Recht zum Anlegen (Team). */
    teamGroupIds: number[];
    /** Gruppen mit Zugang zum Admin-Bereich (immer inkl. chayns-Manager 1). */
    adminGroupIds: number[];
    /** Nur lokal: Anmeldung ohne chayns (POST /api/auth/dev). Niemals in Produktion setzen. */
    devLogin: boolean;
    logLevel: LogLevel;
    /** SMTP für die E-Mail-Kopie an den Auftraggeber; null = Versand nicht eingerichtet. */
    smtp: SmtpConfig | null;
}

export interface SmtpConfig {
    host: string;
    port: number;
    /** true = TLS ab Verbindungsbeginn (465), false = STARTTLS (587, erzwungen). */
    secure: boolean;
    user: string;
    pass: string;
    from: string;
    fromName: string;
    /** Antwortadresse (z. B. Büro Lansing); leer = keine. */
    replyTo: string;
    /** Blindkopie jeder Mail (z. B. Ablage); leer = keine. */
    bcc: string;
    /** Größere PDFs werden nicht verschickt (Postfächer lehnen sie ab). */
    maxAttachmentBytes: number;
}

/** Höchstzahl automatischer Versandversuche je Bericht. */
export const MAIL_MAX_ATTEMPTS = 3;
/** Wartezeit zwischen zwei automatischen Versuchen. */
export const MAIL_RETRY_AFTER_MINUTES = 15;
/** Intervall der Versand-Wiederholung. */
export const MAIL_RETRY_INTERVAL_MS = 5 * 60_000;

function loadSmtp(env: NodeJS.ProcessEnv): SmtpConfig | null {
    const host = (env.SMTP_HOST ?? '').trim();
    const user = (env.SMTP_USER ?? '').trim();
    // Leere Stack-Variablen (MAIL_FROM: "") zählen als nicht gesetzt.
    const from = (env.MAIL_FROM || '').trim() || user;
    if (!host || !from) return null;
    const port = readInt(env.SMTP_PORT, 587);
    return {
        host,
        port,
        secure: env.SMTP_SECURE ? env.SMTP_SECURE.toLowerCase() === 'true' : port === 465,
        user,
        pass: env.SMTP_PASS ?? '',
        from,
        fromName: (env.MAIL_FROM_NAME || '').trim() || 'LANSING Metallbau – Bautagesbericht',
        replyTo: (env.MAIL_REPLY_TO ?? '').trim(),
        bcc: (env.MAIL_BCC ?? '').trim(),
        maxAttachmentBytes: readInt(env.MAIL_MAX_MB, 20) * 1024 * 1024,
    };
}

function readInt(value: string | undefined, fallback: number): number {
    const parsed = Number.parseInt(value ?? '', 10);
    return Number.isFinite(parsed) ? parsed : fallback;
}

export function parseGroupList(value: string | undefined, fallback: number): number[] {
    const ids = (value ?? '')
        .split(',')
        .map((part) => Number.parseInt(part.trim(), 10))
        .filter((id) => Number.isInteger(id) && id > 0);
    return ids.length > 0 ? ids : [fallback];
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
    const logLevel = (env.LOG_LEVEL ?? '').toLowerCase();
    const dataDir = env.DATA_DIR || '/data';
    return {
        port: readInt(env.PORT, 8080),
        host: env.HOST ?? '',
        dataDir,
        dbPath: env.DB_PATH || `${dataDir.replace(/[\\/]+$/, '')}/bautagesbericht.db`,
        staticDir: env.STATIC_DIR || 'dist/frontend',
        trustProxy: (env.TRUST_PROXY ?? '').toLowerCase() === 'true',
        bridgeUrl: (env.BRIDGE_URL ?? '').trim(),
        bridgeSecret: env.BRIDGE_SECRET ?? '',
        teamGroupIds: parseGroupList(env.UAC_GROUP_TEAM, DEFAULT_UAC_GROUP_TEAM),
        // Manager der Site sind immer Admin.
        adminGroupIds: [...new Set([...parseGroupList(env.UAC_GROUP_ADMIN, DEFAULT_UAC_GROUP_ADMIN), CHAYNS_MANAGER_GROUP])],
        devLogin: (env.DEV_LOGIN ?? '').toLowerCase() === 'true' && env.NODE_ENV !== 'production',
        logLevel: isLogLevel(logLevel) ? logLevel : 'info',
        smtp: loadSmtp(env),
    };
}
