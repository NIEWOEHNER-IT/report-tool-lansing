/**
 * Absenden: Prüfen, PDF erzeugen, Bericht anlegen, Dateien in Stücken hochladen, abschließen.
 * Bricht die Verbindung ab, setzt ein erneutes Absenden (gleiche clientId) beim letzten Stück fort.
 */
import {
    FORM_LIMITS,
    isValidDayKey,
    isValidEmail,
    pdfFileName,
    type CreateReportRequest,
    type CreateReportResponse,
    type ReportData,
    type ReportDetail,
} from '../../../shared/contract';
import { authRequest, uploadChunk } from '../common/api';
import type { Draft } from './draft';
import { flattenPhoto } from './image';
import { layoutEvents, layoutExtra, layoutWork } from './pdf/layout';
import { captionFits, renderReportPdf } from './pdf/render';
import { getPhoto } from './photoStore';

const PDF_NAME = 'bericht.pdf';
const photoName = (i: number) => `foto-${String(i + 1).padStart(2, '0')}.jpg`;

export interface Problem {
    field: string;
    text: string;
}

/** Pflichtangaben und Platz im Formular. Leere Liste = absendebereit. */
export function checkDraft(draft: Draft): Problem[] {
    const problems: Problem[] = [];
    if (!/^\d{7}$/.test(draft.projektnummer.trim())) problems.push({ field: 'projekt', text: 'Projektnummer (7 Ziffern) fehlt.' });
    if (!/^\d{1,6}$/.test(draft.berichtNr.trim())) problems.push({ field: 'projekt', text: 'Berichtsnummer (nur Ziffern) fehlt.' });
    if (!draft.leitenderMonteur.trim()) problems.push({ field: 'projekt', text: 'Leitender Monteur fehlt.' });
    if (!isValidDayKey(draft.datum)) problems.push({ field: 'zeit', text: 'Datum fehlt.' });
    if (draft.beginn && draft.ende && draft.ende <= draft.beginn) problems.push({ field: 'zeit', text: 'Das Ende liegt vor dem Beginn.' });
    if (draft.mitarbeiter.length > FORM_LIMITS.mitarbeiter) problems.push({ field: 'team', text: `Höchstens ${FORM_LIMITS.mitarbeiter} Mitarbeiter.` });
    const work = layoutWork(draft.arbeiten);
    if (!work.fits) problems.push({ field: 'arbeiten', text: `Ausgeführte Arbeiten: ${work.used} von ${work.max} Zeilen – bitte kürzen.` });
    const extra = layoutExtra(draft.zusatz);
    if (!extra.fits) problems.push({ field: 'zusatz', text: `Zusätzliche Arbeiten: ${extra.used} von ${extra.max} Zeilen – bitte kürzen.` });
    const events = layoutEvents(draft.vorkommnisse);
    if (!events.fits) problems.push({ field: 'vorkommnisse', text: `Besondere Vorkommnisse: ${events.used} von ${events.max} Zeilen – bitte kürzen.` });
    draft.photos.forEach((photo, i) => {
        if (!captionFits(photo.caption)) problems.push({ field: 'fotos', text: `Beschreibung zu Bild ${i + 1} ist zu lang.` });
    });
    if (draft.unterschriftLansing.image && !draft.leitenderMonteur.trim()) {
        problems.push({ field: 'unterschriften', text: 'Für die Unterschrift LANSING den leitenden Monteur eintragen.' });
    }
    if (draft.auftraggeberEmail && !isValidEmail(draft.auftraggeberEmail)) {
        problems.push({ field: 'unterschriften', text: 'Die E-Mail-Adresse des Auftraggebers ist ungültig.' });
    }
    if (draft.unterschriftAuftraggeber.image && !draft.unterschriftAuftraggeber.name.trim()) {
        problems.push({ field: 'unterschriften', text: 'Name zur Unterschrift des Auftraggebers fehlt.' });
    }
    return problems;
}

export function toReportData(draft: Draft): ReportData {
    const { clientId: _clientId, photos, ...rest } = draft;
    return {
        ...rest,
        unterschriftLansing: { ...draft.unterschriftLansing, name: draft.unterschriftLansing.image ? draft.leitenderMonteur : '' },
        fotos: photos.map((photo, i) => ({ file: photoName(i), caption: photo.caption })),
    };
}

export type SubmitStep = 'pdf' | 'upload' | 'done';

export interface SubmitProgress {
    step: SubmitStep;
    /** 0…1 */
    fraction: number;
    text: string;
}

export interface SubmitResult {
    report: ReportDetail;
    pdf: Blob;
    fileName: string;
}

export async function submitDraft(draft: Draft, onProgress: (progress: SubmitProgress) => void): Promise<SubmitResult> {
    onProgress({ step: 'pdf', fraction: 0, text: 'Fotos werden vorbereitet …' });
    const photoBlobs: Blob[] = [];
    for (const [i, photo] of draft.photos.entries()) {
        const stored = await getPhoto(photo.id);
        if (!stored) throw new Error(`Bild ${i + 1} ist auf diesem Gerät nicht mehr vorhanden. Bitte entfernen und neu hinzufügen.`);
        photoBlobs.push(await flattenPhoto(stored.original, stored.annotation));
    }
    const pdf = await renderReportPdf(
        draft,
        photoBlobs.map((image, i) => ({ image, caption: draft.photos[i]!.caption })),
        (done, total) => onProgress({ step: 'pdf', fraction: (done / total) * 0.3, text: `PDF wird erstellt (Seite ${done} von ${total}) …` }),
    );

    const files: { name: string; blob: Blob; kind: 'pdf' | 'photo' }[] = [
        { name: PDF_NAME, blob: pdf, kind: 'pdf' },
        ...photoBlobs.map((blob, i) => ({ name: photoName(i), blob, kind: 'photo' as const })),
    ];
    const request: CreateReportRequest = {
        clientId: draft.clientId,
        data: toReportData(draft),
        files: files.map((file) => ({
            name: file.name,
            kind: file.kind,
            contentType: file.kind === 'pdf' ? 'application/pdf' : 'image/jpeg',
            size: file.blob.size,
        })),
    };
    onProgress({ step: 'upload', fraction: 0.3, text: 'Bericht wird gespeichert …' });
    const created = await authRequest<CreateReportResponse>('POST', '/api/reports', request);

    const total = files.reduce((sum, file) => sum + file.blob.size, 0);
    let sent = created.files.reduce((sum, state) => sum + state.received, 0);
    if (created.status !== 'complete') {
        for (const file of files) {
            const state = created.files.find((s) => s.name === file.name);
            let received = state?.received ?? 0;
            let attempts = 0;
            while (received < file.blob.size) {
                const end = Math.min(received + created.chunkBytes, file.blob.size);
                try {
                    const result = await uploadChunk(
                        `/api/reports/${created.id}/files/${encodeURIComponent(file.name)}?offset=${received}`,
                        file.blob.slice(received, end),
                    );
                    sent += result.received - received;
                    received = result.received;
                    attempts = 0;
                } catch (err) {
                    // Kurze Funklöcher abfangen: bis zu 3 Wiederholungen je Stück.
                    attempts += 1;
                    if (attempts > 3) throw err;
                    await new Promise((resolve) => window.setTimeout(resolve, 1500 * attempts));
                }
                onProgress({
                    step: 'upload',
                    fraction: 0.3 + 0.68 * (sent / Math.max(total, 1)),
                    text: `Hochladen … ${Math.round(sent / 1024 / 1024 * 10) / 10} von ${Math.round(total / 1024 / 1024 * 10) / 10} MB`,
                });
            }
        }
    }
    const report = await authRequest<ReportDetail>('POST', `/api/reports/${created.id}/complete`);
    onProgress({ step: 'done', fraction: 1, text: 'Gespeichert.' });
    return { report, pdf, fileName: pdfFileName(request.data) };
}
