/**
 * SQLite (node:sqlite, synchron) mit Schema-Migrationen über PRAGMA user_version.
 * Berichtsdaten liegen als JSON in `report.data_json`; Dateien (PDF, Fotos) im Dateisystem
 * (siehe files.ts), hier nur ihre Metadaten.
 */
import { DatabaseSync } from 'node:sqlite';
import type { MailInfo, MailStatus, ReportData, ReportFileKind, ReportStatus, ReportSummary, Role } from '../../shared/contract';

const MIGRATIONS: string[] = [
    `
    CREATE TABLE report (
        id            TEXT PRIMARY KEY,
        client_id     TEXT NOT NULL,
        person_id     TEXT NOT NULL,
        person_name   TEXT,
        status        TEXT NOT NULL,
        report_date   TEXT NOT NULL,
        iso_week      TEXT NOT NULL,
        projektnummer TEXT NOT NULL,
        bericht_nr    TEXT NOT NULL,
        bauvorhaben   TEXT NOT NULL,
        monteur       TEXT NOT NULL,
        photo_count   INTEGER NOT NULL DEFAULT 0,
        data_json     TEXT NOT NULL,
        created_at    TEXT NOT NULL,
        completed_at  TEXT,
        UNIQUE (person_id, client_id)
    );
    CREATE INDEX report_date_idx ON report (report_date);
    CREATE INDEX report_person_idx ON report (person_id, created_at);

    CREATE TABLE report_file (
        report_id     TEXT NOT NULL REFERENCES report (id) ON DELETE CASCADE,
        name          TEXT NOT NULL,
        kind          TEXT NOT NULL,
        content_type  TEXT NOT NULL,
        size          INTEGER NOT NULL,
        received      INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (report_id, name)
    );

    CREATE TABLE session (
        token_hash  TEXT PRIMARY KEY,
        role        TEXT NOT NULL,
        person_id   TEXT NOT NULL,
        person_name TEXT,
        created_at  TEXT NOT NULL,
        expires_at  TEXT NOT NULL
    );

    CREATE TABLE challenge (
        nonce      TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        used_at    TEXT
    );

    CREATE TABLE setting (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
    );
    `,
    // 2 - E-Mail-Kopie an den Auftraggeber
    `
    ALTER TABLE report ADD COLUMN mail_status   TEXT NOT NULL DEFAULT 'none';
    ALTER TABLE report ADD COLUMN mail_to       TEXT NOT NULL DEFAULT '';
    ALTER TABLE report ADD COLUMN mail_sent_at  TEXT;
    ALTER TABLE report ADD COLUMN mail_error    TEXT;
    ALTER TABLE report ADD COLUMN mail_attempts INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE report ADD COLUMN mail_last_try TEXT;
    `,
];

export function openDatabase(path: string): DatabaseSync {
    const db = new DatabaseSync(path);
    db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    const row = db.prepare('PRAGMA user_version').get() as { user_version: number };
    for (let version = row.user_version; version < MIGRATIONS.length; version += 1) {
        db.exec('BEGIN');
        try {
            db.exec(MIGRATIONS[version]!);
            db.exec(`PRAGMA user_version = ${version + 1}`);
            db.exec('COMMIT');
        } catch (err) {
            db.exec('ROLLBACK');
            throw err;
        }
    }
    return db;
}

export interface SessionRecord {
    tokenHash: string;
    role: Role;
    personId: string;
    personName: string | null;
    createdAt: string;
    expiresAt: string;
}

export interface ReportRecord {
    id: string;
    clientId: string;
    personId: string;
    personName: string | null;
    status: ReportStatus;
    reportDate: string;
    isoWeek: string;
    projektnummer: string;
    berichtNr: string;
    bauvorhaben: string;
    monteur: string;
    photoCount: number;
    dataJson: string;
    createdAt: string;
    completedAt: string | null;
    mail: MailInfo & { lastTry: string | null };
}

export const NO_MAIL: ReportRecord['mail'] = { status: 'none', to: '', sentAt: null, error: null, attempts: 0, lastTry: null };

export interface FileRecord {
    reportId: string;
    name: string;
    kind: ReportFileKind;
    contentType: string;
    size: number;
    received: number;
}

type Row = Record<string, unknown>;

function toReport(row: Row): ReportRecord {
    return {
        id: row.id as string,
        clientId: row.client_id as string,
        personId: row.person_id as string,
        personName: (row.person_name as string | null) ?? null,
        status: row.status as ReportStatus,
        reportDate: row.report_date as string,
        isoWeek: row.iso_week as string,
        projektnummer: row.projektnummer as string,
        berichtNr: row.bericht_nr as string,
        bauvorhaben: row.bauvorhaben as string,
        monteur: row.monteur as string,
        photoCount: Number(row.photo_count),
        dataJson: row.data_json as string,
        createdAt: row.created_at as string,
        completedAt: (row.completed_at as string | null) ?? null,
        mail: {
            status: ((row.mail_status as string) || 'none') as MailStatus,
            to: (row.mail_to as string) || '',
            sentAt: (row.mail_sent_at as string | null) ?? null,
            error: (row.mail_error as string | null) ?? null,
            attempts: Number(row.mail_attempts ?? 0),
            lastTry: (row.mail_last_try as string | null) ?? null,
        },
    };
}

function toFile(row: Row): FileRecord {
    return {
        reportId: row.report_id as string,
        name: row.name as string,
        kind: row.kind as ReportFileKind,
        contentType: row.content_type as string,
        size: Number(row.size),
        received: Number(row.received),
    };
}

export function toSummary(report: ReportRecord, files: FileRecord[]): ReportSummary {
    const pdf = files.find((file) => file.kind === 'pdf');
    return {
        id: report.id,
        status: report.status,
        projektnummer: report.projektnummer,
        berichtNr: report.berichtNr,
        bauvorhaben: report.bauvorhaben,
        leitenderMonteur: report.monteur,
        datum: report.reportDate,
        isoWeek: report.isoWeek,
        createdAt: report.createdAt,
        createdBy: { personId: report.personId, name: report.personName },
        photoCount: report.photoCount,
        pdfSize: pdf?.size ?? 0,
        mail: { status: report.mail.status, to: report.mail.to, sentAt: report.mail.sentAt, error: report.mail.error, attempts: report.mail.attempts },
    };
}

export function parseReportData(report: ReportRecord): ReportData {
    return JSON.parse(report.dataJson) as ReportData;
}

/** Datenzugriff; alle Methoden synchron. */
export class Store {
    constructor(readonly db: DatabaseSync) {}

    // Sitzungen -------------------------------------------------------------

    insertSession(session: SessionRecord): void {
        this.db
            .prepare('INSERT INTO session (token_hash, role, person_id, person_name, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
            .run(session.tokenHash, session.role, session.personId, session.personName, session.createdAt, session.expiresAt);
    }

    getSession(tokenHash: string): SessionRecord | null {
        const row = this.db.prepare('SELECT * FROM session WHERE token_hash = ?').get(tokenHash) as Row | undefined;
        if (!row) return null;
        return {
            tokenHash: row.token_hash as string,
            role: row.role as Role,
            personId: row.person_id as string,
            personName: (row.person_name as string | null) ?? null,
            createdAt: row.created_at as string,
            expiresAt: row.expires_at as string,
        };
    }

    deleteSession(tokenHash: string): void {
        this.db.prepare('DELETE FROM session WHERE token_hash = ?').run(tokenHash);
    }

    // Nonces ----------------------------------------------------------------

    insertChallenge(nonce: string, createdAt: string, expiresAt: string): void {
        this.db.prepare('INSERT INTO challenge (nonce, created_at, expires_at) VALUES (?, ?, ?)').run(nonce, createdAt, expiresAt);
    }

    /** Entwertet die Nonce genau einmal; false, wenn unbekannt, benutzt oder abgelaufen. */
    consumeChallenge(nonce: string, now: string): boolean {
        const result = this.db
            .prepare('UPDATE challenge SET used_at = ? WHERE nonce = ? AND used_at IS NULL AND expires_at > ?')
            .run(now, nonce, now);
        return Number(result.changes) === 1;
    }

    // Berichte --------------------------------------------------------------

    insertReport(report: ReportRecord, files: FileRecord[]): void {
        this.db.exec('BEGIN');
        try {
            this.db
                .prepare(
                    `INSERT INTO report (id, client_id, person_id, person_name, status, report_date, iso_week, projektnummer,
                     bericht_nr, bauvorhaben, monteur, photo_count, data_json, created_at, completed_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                )
                .run(
                    report.id,
                    report.clientId,
                    report.personId,
                    report.personName,
                    report.status,
                    report.reportDate,
                    report.isoWeek,
                    report.projektnummer,
                    report.berichtNr,
                    report.bauvorhaben,
                    report.monteur,
                    report.photoCount,
                    report.dataJson,
                    report.createdAt,
                    report.completedAt,
                );
            const insertFile = this.db.prepare(
                'INSERT INTO report_file (report_id, name, kind, content_type, size, received) VALUES (?, ?, ?, ?, ?, 0)',
            );
            for (const file of files) insertFile.run(report.id, file.name, file.kind, file.contentType, file.size);
            this.db.exec('COMMIT');
        } catch (err) {
            this.db.exec('ROLLBACK');
            throw err;
        }
    }

    getReport(id: string): ReportRecord | null {
        const row = this.db.prepare('SELECT * FROM report WHERE id = ?').get(id) as Row | undefined;
        return row ? toReport(row) : null;
    }

    getReportByClientId(personId: string, clientId: string): ReportRecord | null {
        const row = this.db.prepare('SELECT * FROM report WHERE person_id = ? AND client_id = ?').get(personId, clientId) as Row | undefined;
        return row ? toReport(row) : null;
    }

    getFiles(reportId: string): FileRecord[] {
        return (this.db.prepare('SELECT * FROM report_file WHERE report_id = ? ORDER BY name').all(reportId) as Row[]).map(toFile);
    }

    getFile(reportId: string, name: string): FileRecord | null {
        const row = this.db.prepare('SELECT * FROM report_file WHERE report_id = ? AND name = ?').get(reportId, name) as Row | undefined;
        return row ? toFile(row) : null;
    }

    setReceived(reportId: string, name: string, received: number): void {
        this.db.prepare('UPDATE report_file SET received = ? WHERE report_id = ? AND name = ?').run(received, reportId, name);
    }

    completeReport(id: string, now: string): void {
        this.db.prepare("UPDATE report SET status = 'complete', completed_at = ? WHERE id = ?").run(now, id);
    }

    /** Versandstatus setzen (nur übergebene Felder). */
    setMail(id: string, change: Partial<ReportRecord['mail']>): void {
        const columns: Record<keyof ReportRecord['mail'], string> = {
            status: 'mail_status',
            to: 'mail_to',
            sentAt: 'mail_sent_at',
            error: 'mail_error',
            attempts: 'mail_attempts',
            lastTry: 'mail_last_try',
        };
        const entries = Object.entries(change).filter(([key]) => key in columns) as [keyof ReportRecord['mail'], string | number | null][];
        if (entries.length === 0) return;
        const sql = `UPDATE report SET ${entries.map(([key]) => `${columns[key]} = ?`).join(', ')} WHERE id = ?`;
        this.db.prepare(sql).run(...entries.map(([, value]) => value), id);
    }

    /** Berichte, deren Mail (noch) nicht verschickt ist und erneut versucht werden darf. */
    listMailRetries(maxAttempts: number, triedBefore: string): ReportRecord[] {
        return (
            this.db
                .prepare(
                    `SELECT * FROM report WHERE status = 'complete' AND mail_status = 'pending' AND mail_attempts < ?
                     AND (mail_last_try IS NULL OR mail_last_try < ?) ORDER BY created_at LIMIT 20`,
                )
                .all(maxAttempts, triedBefore) as Row[]
        ).map(toReport);
    }

    deleteReport(id: string): void {
        this.db.prepare('DELETE FROM report WHERE id = ?').run(id);
    }

    /** Abgeschlossene Berichte mit Berichtsdatum im Zeitraum (inklusive). */
    listReportsByDate(from: string, to: string): ReportRecord[] {
        return (
            this.db
                .prepare(
                    "SELECT * FROM report WHERE status = 'complete' AND report_date >= ? AND report_date <= ? ORDER BY report_date DESC, created_at DESC",
                )
                .all(from, to) as Row[]
        ).map(toReport);
    }

    listReportsOfPerson(personId: string, limit: number): ReportRecord[] {
        return (
            this.db
                .prepare("SELECT * FROM report WHERE person_id = ? AND status = 'complete' ORDER BY created_at DESC LIMIT ?")
                .all(personId, limit) as Row[]
        ).map(toReport);
    }

    /** Unvollständige Uploads vor `before` (für das Aufräumen). */
    listStaleUploads(before: string): ReportRecord[] {
        return (this.db.prepare("SELECT * FROM report WHERE status = 'uploading' AND created_at < ?").all(before) as Row[]).map(toReport);
    }

    // Einstellungen ---------------------------------------------------------

    getSetting<T>(key: string, fallback: T): T {
        const row = this.db.prepare('SELECT value FROM setting WHERE key = ?').get(key) as Row | undefined;
        if (!row) return fallback;
        try {
            return JSON.parse(row.value as string) as T;
        } catch {
            return fallback;
        }
    }

    setSetting(key: string, value: unknown): void {
        this.db
            .prepare('INSERT INTO setting (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value')
            .run(key, JSON.stringify(value));
    }

    // Aufräumen -------------------------------------------------------------

    purgeExpired(now: string): void {
        this.db.prepare('DELETE FROM session WHERE expires_at <= ?').run(now);
        this.db.prepare('DELETE FROM challenge WHERE expires_at <= ?').run(now);
    }
}
