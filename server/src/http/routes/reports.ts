/**
 * Berichte: Anlegen, Upload in Stücken, Abschließen, eigene Berichte, Dateien, Admin-Liste.
 *
 * Ablauf beim Absenden (Formular):
 *  1. POST /api/reports {clientId, data, files[]}   -> Bericht im Status "uploading"
 *  2. PUT  /api/reports/:id/files/:name?offset=N    -> je Stück (max. UPLOAD_CHUNK_BYTES)
 *  3. POST /api/reports/:id/complete                -> prüft Vollständigkeit + Dateiformat
 * Wiederholtes Absenden mit derselben clientId setzt einen abgebrochenen Upload fort.
 */
import {
    ErrorCodes,
    isoWeekOf,
    isValidDayKey,
    isValidEmail,
    pdfFileName,
    UPLOAD_CHUNK_BYTES,
    type CreateReportResponse,
    type ReportDetail,
    type ReportListResponse,
    type ReportSummary,
    type SettingsResponse,
    type UploadState,
} from '../../../../shared/contract';
import { MAX_RANGE_DAYS } from '../../config';
import { NO_MAIL, parseReportData, toSummary, type FileRecord, type ReportRecord } from '../../db';
import { ApiFailure } from '../../errors';
import { deliverReportMail } from '../../mail';
import type { AppContext } from '../router';
import { newId, nowIso } from '../../random';
import { fail, parseCreateRequest, parseEmployees } from '../../validate';
import { readBody, sendStream } from '../respond';
import { HANDLED, type RouteContext, type Route } from '../router';

const EMPLOYEES_KEY = 'employees';

function uploadStates(files: FileRecord[]): UploadState[] {
    return files.map((file) => ({ name: file.name, size: file.size, received: file.received }));
}

function createResponse(report: ReportRecord, files: FileRecord[]): CreateReportResponse {
    return { id: report.id, status: report.status, chunkBytes: UPLOAD_CHUNK_BYTES, files: uploadStates(files) };
}

/** Bericht laden; Mitarbeiter sehen nur eigene, Admins alle. */
function loadAccessible(ctx: RouteContext): ReportRecord {
    const id = ctx.params.id ?? '';
    if (!/^[0-9a-f]{32}$/.test(id)) throw new ApiFailure(ErrorCodes.NOT_FOUND);
    const report = ctx.app.store.getReport(id);
    const session = ctx.session!;
    if (!report || (report.personId !== session.personId && session.role !== 'admin')) throw new ApiFailure(ErrorCodes.NOT_FOUND);
    return report;
}

function loadOwnUpload(ctx: RouteContext): ReportRecord {
    const report = loadAccessible(ctx);
    if (report.personId !== ctx.session!.personId) throw new ApiFailure(ErrorCodes.FORBIDDEN);
    return report;
}

function detailOf(ctx: RouteContext, report: ReportRecord): ReportDetail {
    const files = ctx.app.store.getFiles(report.id);
    return {
        ...toSummary(report, files),
        data: parseReportData(report),
        files: files.map((file) => ({ name: file.name, kind: file.kind, contentType: file.contentType, size: file.size })),
    };
}

function summaries(ctx: RouteContext, reports: ReportRecord[]): ReportSummary[] {
    return reports.map((report) => toSummary(report, ctx.app.store.getFiles(report.id)));
}

function sameUpload(existing: ReportRecord, existingFiles: FileRecord[], dataJson: string, files: { name: string; size: number }[]): boolean {
    if (existing.dataJson !== dataJson || existingFiles.length !== files.length) return false;
    return files.every((file) => existingFiles.some((e) => e.name === file.name && e.size === file.size));
}

const MAGIC: Record<string, (head: Buffer) => boolean> = {
    pdf: (head) => head.subarray(0, 5).toString('latin1') === '%PDF-',
    photo: (head) => head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff,
};

/** Versand im Hintergrund starten (Antwort wartet nicht). */
function sendMailInBackground(app: AppContext, reportId: string): void {
    const report = app.store.getReport(reportId);
    if (!report) return;
    const task = deliverReportMail({ store: app.store, files: app.files, logger: app.logger, smtp: app.config.smtp, transport: app.mail }, report)
        .catch((err: unknown) => app.logger.error('mail.unexpected', { error: err }))
        .finally(() => app.background.delete(task));
    app.background.add(task);
}

function daysBetween(from: string, to: string): number {
    return (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
}

export const reportRoutes: Route[] = [
    {
        method: 'POST',
        path: '/api/reports',
        access: 'employee',
        handler: async (ctx) => {
            const { app, session } = ctx;
            const request = parseCreateRequest(await ctx.body());
            const dataJson = JSON.stringify(request.data);
            const existing = app.store.getReportByClientId(session!.personId, request.clientId);
            if (existing) {
                const existingFiles = app.store.getFiles(existing.id);
                // Unveränderter Entwurf: Upload fortsetzen bzw. bereits gespeicherten Bericht melden.
                if (sameUpload(existing, existingFiles, dataJson, request.files)) return createResponse(existing, existingFiles);
                // Entwurf wurde danach geändert (z. B. E-Mail ergänzt): neuer Stand ersetzt den alten.
                app.store.deleteReport(existing.id);
                await app.files.removeReport(existing.id);
                app.logger.info('report.replaced', { id: existing.id, wasComplete: existing.status === 'complete' });
            }
            const report: ReportRecord = {
                id: newId(),
                clientId: request.clientId,
                personId: session!.personId,
                personName: session!.personName,
                status: 'uploading',
                reportDate: request.data.datum,
                isoWeek: isoWeekOf(request.data.datum),
                projektnummer: request.data.projektnummer,
                berichtNr: request.data.berichtNr,
                bauvorhaben: request.data.bauvorhaben,
                monteur: request.data.leitenderMonteur,
                photoCount: request.data.fotos.length,
                dataJson,
                createdAt: nowIso(),
                completedAt: null,
                mail: NO_MAIL,
            };
            const files: FileRecord[] = request.files.map((file) => ({ ...file, reportId: report.id, received: 0 }));
            app.store.insertReport(report, files);
            app.logger.info('report.created', { id: report.id, personId: report.personId, files: files.length });
            return createResponse(report, files);
        },
    },
    {
        method: 'PUT',
        path: '/api/reports/:id/files/:name',
        access: 'employee',
        limiter: 'upload',
        handler: async (ctx) => {
            const report = loadOwnUpload(ctx);
            const file = ctx.app.store.getFile(report.id, ctx.params.name ?? '');
            if (!file) throw new ApiFailure(ErrorCodes.NOT_FOUND);
            if (report.status === 'complete') {
                ctx.req.resume();
                return { received: file.size };
            }
            const offsetText = ctx.url.searchParams.get('offset') ?? '';
            if (!/^\d{1,12}$/.test(offsetText)) fail('offset');
            const offset = Number(offsetText);
            const chunk = await readBody(ctx.req, UPLOAD_CHUNK_BYTES + 1024);
            // Nur genau anschließende Stücke schreiben; sonst aktuellen Stand melden (Wiederholung/Lücke).
            if (offset !== file.received || chunk.length === 0) return { received: file.received };
            if (offset + chunk.length > file.size) fail('offset', 'Das Stück ist größer als angekündigt.');
            await ctx.app.files.writeChunk(report.id, file.name, offset, chunk);
            const received = offset + chunk.length;
            ctx.app.store.setReceived(report.id, file.name, received);
            return { received };
        },
    },
    {
        method: 'POST',
        path: '/api/reports/:id/complete',
        access: 'employee',
        handler: async (ctx) => {
            const { app } = ctx;
            const report = loadOwnUpload(ctx);
            if (report.status !== 'complete') {
                const files = app.store.getFiles(report.id);
                const missing = files.filter((file) => file.received !== file.size).map((file) => file.name);
                if (missing.length > 0) {
                    throw new ApiFailure(ErrorCodes.CONFLICT, 'Es fehlen noch Teile von Dateien. Bitte erneut senden.', missing);
                }
                for (const file of files) {
                    const onDisk = await app.files.sizeOf(report.id, file.name);
                    const head = await app.files.readHead(report.id, file.name, 8);
                    if (onDisk !== file.size || !MAGIC[file.kind]!(head)) {
                        throw new ApiFailure(ErrorCodes.VALIDATION_ERROR, `Die Datei ${file.name} ist beschädigt.`, [file.name]);
                    }
                }
                app.store.completeReport(report.id, nowIso());
                app.logger.info('report.completed', { id: report.id, personId: report.personId });
                const email = parseReportData(report).auftraggeberEmail;
                if (email) {
                    app.store.setMail(report.id, { status: 'pending', to: email, attempts: 0, error: null });
                    sendMailInBackground(app, report.id);
                }
            }
            return detailOf(ctx, app.store.getReport(report.id)!);
        },
    },
    {
        method: 'GET',
        path: '/api/reports/mine',
        access: 'employee',
        handler: (ctx): ReportSummary[] => summaries(ctx, ctx.app.store.listReportsOfPerson(ctx.session!.personId, 30)),
    },
    {
        method: 'GET',
        path: '/api/reports/:id',
        access: 'employee',
        handler: (ctx): ReportDetail => detailOf(ctx, loadAccessible(ctx)),
    },
    {
        method: 'GET',
        path: '/api/reports/:id/files/:name',
        access: 'employee',
        handler: (ctx) => {
            const report = loadAccessible(ctx);
            if (report.status !== 'complete') throw new ApiFailure(ErrorCodes.NOT_FOUND);
            const file = ctx.app.store.getFile(report.id, ctx.params.name ?? '');
            if (!file) throw new ApiFailure(ErrorCodes.NOT_FOUND);
            const data = parseReportData(report);
            sendStream(ctx.res, ctx.app.files.stream(report.id, file.name), {
                contentType: file.contentType,
                size: file.size,
                fileName: file.kind === 'pdf' ? pdfFileName(data) : `${report.projektnummer}_${report.berichtNr}_${file.name}`,
                inline: ctx.url.searchParams.get('download') !== '1',
            });
            return HANDLED;
        },
    },
    {
        method: 'GET',
        path: '/api/settings',
        access: 'employee',
        handler: ({ app }): SettingsResponse => ({ employees: app.store.getSetting<string[]>(EMPLOYEES_KEY, []) }),
    },

    // Admin -------------------------------------------------------------------

    {
        method: 'GET',
        path: '/api/admin/reports',
        access: 'admin',
        handler: (ctx): ReportListResponse => {
            const from = ctx.url.searchParams.get('from') ?? '';
            const to = ctx.url.searchParams.get('to') ?? '';
            if (!isValidDayKey(from)) fail('from', 'Startdatum im Format JJJJ-MM-TT erwartet.');
            if (!isValidDayKey(to)) fail('to', 'Enddatum im Format JJJJ-MM-TT erwartet.');
            if (to < from) fail('to', 'Das Enddatum liegt vor dem Startdatum.');
            if (daysBetween(from, to) > MAX_RANGE_DAYS) fail('to', `Bitte höchstens ${MAX_RANGE_DAYS} Tage wählen.`);
            return { from, to, reports: summaries(ctx, ctx.app.store.listReportsByDate(from, to)) };
        },
    },
    {
        method: 'DELETE',
        path: '/api/admin/reports/:id',
        access: 'admin',
        handler: async (ctx) => {
            const report = loadAccessible(ctx);
            ctx.app.store.deleteReport(report.id);
            await ctx.app.files.removeReport(report.id);
            ctx.app.logger.info('report.deleted', { id: report.id, by: ctx.session!.personId });
            return { ok: true };
        },
    },
    {
        // E-Mail erneut senden, optional an eine korrigierte Adresse. Wartet auf das Ergebnis.
        method: 'POST',
        path: '/api/admin/reports/:id/mail',
        access: 'admin',
        handler: async (ctx): Promise<ReportSummary> => {
            const report = loadAccessible(ctx);
            if (report.status !== 'complete') throw new ApiFailure(ErrorCodes.CONFLICT, 'Der Bericht ist noch nicht vollständig gespeichert.');
            if (!ctx.app.mail) throw new ApiFailure(ErrorCodes.CONFLICT, 'Der Mailversand ist auf dem Server nicht eingerichtet.');
            const input = await ctx.body();
            const to = typeof input.to === 'string' && input.to.trim() ? input.to.trim() : report.mail.to;
            if (!to || !isValidEmail(to)) fail('to', 'Bitte eine gültige E-Mail-Adresse angeben.');
            ctx.app.store.setMail(report.id, { status: 'pending', to, attempts: 0, error: null });
            await deliverReportMail(
                { store: ctx.app.store, files: ctx.app.files, logger: ctx.app.logger, smtp: ctx.app.config.smtp, transport: ctx.app.mail },
                ctx.app.store.getReport(report.id)!,
            );
            ctx.app.logger.info('mail.resend', { id: report.id, by: ctx.session!.personId });
            const updated = ctx.app.store.getReport(report.id)!;
            return toSummary(updated, ctx.app.store.getFiles(updated.id));
        },
    },
    {
        method: 'PUT',
        path: '/api/admin/settings',
        access: 'admin',
        handler: async ({ app, body }): Promise<SettingsResponse> => {
            const employees = parseEmployees((await body()).employees);
            app.store.setSetting(EMPLOYEES_KEY, employees);
            return { employees };
        },
    },
];
