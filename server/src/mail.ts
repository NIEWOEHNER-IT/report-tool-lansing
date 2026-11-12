/**
 * E-Mail-Kopie des Berichts an den Auftraggeber (PDF im Anhang).
 *
 * Versand läuft nach dem Abschließen im Hintergrund; das Speichern wartet nicht darauf.
 * Fehlgeschlagene Versuche wiederholt der Aufräum-Job (MAIL_MAX_ATTEMPTS, Abstand
 * MAIL_RETRY_AFTER_MINUTES); danach Status "failed", im Admin-Bereich erneut auslösbar.
 */
import nodemailer from 'nodemailer';
import { formatDayKey, pdfFileName, type ReportData } from '../../shared/contract';
import { MAIL_MAX_ATTEMPTS, type SmtpConfig } from './config';
import { parseReportData, type ReportRecord, type Store } from './db';
import type { FileStore } from './files';
import { PDF_NAME } from './files';
import type { Logger } from './logger';
import { nowIso } from './random';

export interface OutgoingMail {
    from: { name: string; address: string };
    to: string;
    bcc?: string;
    replyTo?: string;
    subject: string;
    text: string;
    attachments: { filename: string; path: string; contentType: string }[];
}

/** Versandweg; in Tests durch eine Attrappe ersetzbar. */
export interface MailTransport {
    send(mail: OutgoingMail): Promise<void>;
}

export function createSmtpTransport(config: SmtpConfig): MailTransport {
    const transporter = nodemailer.createTransport({
        host: config.host,
        port: config.port,
        secure: config.secure,
        requireTLS: !config.secure,
        auth: config.user ? { user: config.user, pass: config.pass } : undefined,
        connectionTimeout: 20_000,
        greetingTimeout: 20_000,
        socketTimeout: 60_000,
    });
    return {
        async send(mail) {
            await transporter.sendMail(mail);
        },
    };
}

export function composeMail(config: SmtpConfig, data: ReportData, to: string, pdfPath: string): OutgoingMail {
    const datum = formatDayKey(data.datum);
    const anrede = data.unterschriftAuftraggeber.name ? `Guten Tag ${data.unterschriftAuftraggeber.name},` : 'Guten Tag,';
    const bauvorhaben = data.bauvorhaben ? `zum Bauvorhaben „${data.bauvorhaben}“ ` : '';
    const lines = [
        anrede,
        '',
        `anbei erhalten Sie den Bautagesbericht Nr. ${data.berichtNr} ${bauvorhaben}(Projekt ${data.projektnummer}) vom ${datum} als PDF.`,
        data.leitenderMonteur ? `Leitender Monteur: ${data.leitenderMonteur}` : '',
        '',
        config.replyTo
            ? `Diese E-Mail wurde automatisch versendet. Bei Rückfragen antworten Sie bitte direkt auf diese E-Mail (an ${config.replyTo}).`
            : 'Diese E-Mail wurde automatisch versendet. Bitte antworten Sie nicht auf diese Adresse.',
        '',
        'Mit freundlichen Grüßen',
        'LANSING Metallbau',
    ].filter((line, i, all) => !(line === '' && all[i - 1] === ''));
    return {
        from: { name: config.fromName, address: config.from },
        to,
        bcc: config.bcc || undefined,
        replyTo: config.replyTo || undefined,
        subject: `Bautagesbericht ${data.projektnummer} Nr. ${data.berichtNr} vom ${datum} – LANSING Metallbau`,
        text: lines.join('\n'),
        attachments: [{ filename: pdfFileName(data), path: pdfPath, contentType: 'application/pdf' }],
    };
}

/** Fehlermeldung ohne Zugangsdaten, kurz genug für die Anzeige im Admin-Bereich. */
function mailError(err: unknown): string {
    const record = err as { responseCode?: number; response?: string; code?: string; message?: string };
    const text = record.response || record.message || String(err);
    return `${record.responseCode ?? record.code ?? ''} ${text}`.trim().slice(0, 300);
}

export interface MailContext {
    store: Store;
    files: FileStore;
    logger: Logger;
    smtp: SmtpConfig | null;
    transport: MailTransport | null;
}

/** Ein Versandversuch; schreibt den Status in die Datenbank. */
export async function deliverReportMail(ctx: MailContext, report: ReportRecord): Promise<void> {
    const to = report.mail.to;
    if (!to || report.status !== 'complete') return;
    if (!ctx.smtp || !ctx.transport) {
        ctx.store.setMail(report.id, { status: 'pending', error: 'Der Mailversand ist auf dem Server nicht eingerichtet.' });
        return;
    }
    const attempts = report.mail.attempts + 1;
    ctx.store.setMail(report.id, { attempts, lastTry: nowIso() });
    const pdf = ctx.store.getFile(report.id, PDF_NAME);
    if (pdf && pdf.size > ctx.smtp.maxAttachmentBytes) {
        ctx.store.setMail(report.id, {
            status: 'failed',
            error: `Das PDF ist mit ${Math.round(pdf.size / 1024 / 1024)} MB zu groß für den Versand per E-Mail.`,
        });
        return;
    }
    try {
        const data = parseReportData(report);
        await ctx.transport.send(composeMail(ctx.smtp, data, to, ctx.files.pathOf(report.id, PDF_NAME)));
        ctx.store.setMail(report.id, { status: 'sent', sentAt: nowIso(), error: null });
        ctx.logger.info('mail.sent', { id: report.id, attempts });
    } catch (err) {
        const error = mailError(err);
        ctx.store.setMail(report.id, { status: attempts >= MAIL_MAX_ATTEMPTS ? 'failed' : 'pending', error });
        ctx.logger.warn('mail.failed', { id: report.id, attempts, error });
    }
}
