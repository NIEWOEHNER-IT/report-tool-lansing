/**
 * Eingabeprüfung. Jede Verletzung wirft VALIDATION_ERROR mit dem betroffenen Feld.
 * Der Bericht wird vollständig normalisiert, bevor er gespeichert wird; unbekannte Felder fallen weg.
 */
import {
    ErrorCodes,
    FORM_LIMITS,
    isValidDayKey,
    isValidEmail,
    type CreateReportRequest,
    type ExtraRow,
    type ReportData,
    type ReportFileKind,
    type SignatureData,
    type WorkRow,
} from '../../shared/contract';
import { MAX_FILE_BYTES } from './config';
import { ApiFailure } from './errors';
import { isAllowedFileName, PDF_NAME, photoFileName } from './files';

export function fail(field: string, message?: string): never {
    throw new ApiFailure(ErrorCodes.VALIDATION_ERROR, message, [field]);
}

export function requireObject(value: unknown, field: string): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(field);
    return value as Record<string, unknown>;
}

export function requireString(value: unknown, field: string, maxLength = 2000): string {
    if (typeof value !== 'string' || value.trim().length === 0 || value.length > maxLength) fail(field);
    return value.trim();
}

/** Text (auch leer). Fehlend = ''. */
function text(value: unknown, field: string, maxLength: number): string {
    if (value === undefined || value === null) return '';
    if (typeof value !== 'string' || value.length > maxLength) fail(field);
    return value.trim();
}

function bool(value: unknown): boolean {
    return value === true;
}

function list(value: unknown, field: string, max: number): unknown[] {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value) || value.length > max) fail(field);
    return value;
}

const SIGNATURE_PREFIX = 'data:image/png;base64,';
const MAX_SIGNATURE_LENGTH = 300_000;

function signature(value: unknown, field: string): SignatureData {
    const record = value === undefined || value === null ? {} : requireObject(value, field);
    const image = record.image;
    if (image !== null && image !== undefined) {
        if (typeof image !== 'string' || !image.startsWith(SIGNATURE_PREFIX) || image.length > MAX_SIGNATURE_LENGTH) {
            fail(`${field}.image`, 'Die Unterschrift ist ungültig.');
        }
        if (!/^[A-Za-z0-9+/=]+$/.test(image.slice(SIGNATURE_PREFIX.length))) fail(`${field}.image`);
    }
    return { name: text(record.name, `${field}.name`, 120), image: typeof image === 'string' ? image : null };
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

function email(value: unknown): string {
    const address = text(value, 'auftraggeberEmail', 200);
    if (address && !isValidEmail(address)) fail('auftraggeberEmail', 'Die E-Mail-Adresse des Auftraggebers ist ungültig.');
    return address;
}

/** Prüft und normalisiert die Berichtsdaten; `photoCount` = Anzahl hochzuladender Fotos. */
export function parseReportData(value: unknown, photoCount: number): ReportData {
    const r = requireObject(value, 'data');
    const projektnummer = text(r.projektnummer, 'projektnummer', 20);
    if (!/^\d{7}$/.test(projektnummer)) fail('projektnummer', 'Bitte eine 7-stellige Projektnummer eintragen.');
    const berichtNr = text(r.berichtNr, 'berichtNr', 6);
    if (!/^\d{1,6}$/.test(berichtNr)) fail('berichtNr', 'Bitte eine numerische Berichtsnummer eintragen.');
    const datum = text(r.datum, 'datum', 10);
    if (!isValidDayKey(datum)) fail('datum', 'Bitte ein gültiges Datum eintragen.');
    const beginn = text(r.beginn, 'beginn', 5);
    const ende = text(r.ende, 'ende', 5);
    if (beginn && !TIME.test(beginn)) fail('beginn');
    if (ende && !TIME.test(ende)) fail('ende');

    const w = r.wetter === undefined ? {} : requireObject(r.wetter, 'wetter');
    const arbeiten = list(r.arbeiten, 'arbeiten', FORM_LIMITS.arbeitenZeilen).map((row, i): WorkRow => {
        const o = requireObject(row, `arbeiten.${i}`);
        return {
            beschreibung: text(o.beschreibung, `arbeiten.${i}.beschreibung`, 500),
            bauteil: text(o.bauteil, `arbeiten.${i}.bauteil`, 60),
            geschoss: text(o.geschoss, `arbeiten.${i}.geschoss`, 30),
            ansicht: text(o.ansicht, `arbeiten.${i}.ansicht`, 30),
        };
    });
    const zusatz = list(r.zusatz, 'zusatz', FORM_LIMITS.zusatzZeilen).map((row, i): ExtraRow => {
        const o = requireObject(row, `zusatz.${i}`);
        return {
            beschreibung: text(o.beschreibung, `zusatz.${i}.beschreibung`, 500),
            mitarbeiter: text(o.mitarbeiter, `zusatz.${i}.mitarbeiter`, 10),
            stunden: text(o.stunden, `zusatz.${i}.stunden`, 10),
        };
    });
    const mitarbeiter = list(r.mitarbeiter, 'mitarbeiter', FORM_LIMITS.mitarbeiter).map((name, i) => text(name, `mitarbeiter.${i}`, 120));
    const fotos = list(r.fotos, 'fotos', FORM_LIMITS.fotos).map((photo, i) => {
        const o = requireObject(photo, `fotos.${i}`);
        return { file: photoFileName(i), caption: text(o.caption, `fotos.${i}.caption`, 1200) };
    });
    if (fotos.length !== photoCount) fail('fotos', 'Anzahl der Fotos passt nicht zu den Dateien.');

    return {
        projektnummer,
        berichtNr,
        bauvorhaben: text(r.bauvorhaben, 'bauvorhaben', 200),
        leitenderMonteur: text(r.leitenderMonteur, 'leitenderMonteur', 120),
        datum,
        beginn,
        ende,
        wetter: { regen: bool(w.regen), frost: bool(w.frost), schnee: bool(w.schnee), sonne: bool(w.sonne), wind: bool(w.wind) },
        temperatur: text(r.temperatur, 'temperatur', 20),
        wetterSonstiges: text(r.wetterSonstiges, 'wetterSonstiges', 120),
        baustellenort: text(r.baustellenort, 'baustellenort', 120),
        mitarbeiter: mitarbeiter.filter(Boolean),
        arbeiten: arbeiten.filter((row) => row.beschreibung || row.bauteil || row.geschoss || row.ansicht),
        zusatzAufAnweisung: bool(r.zusatzAufAnweisung),
        zusatz: zusatz.filter((row) => row.beschreibung || row.mitarbeiter || row.stunden),
        vorkommnisse: text(r.vorkommnisse, 'vorkommnisse', 3000),
        unterschriftAuftraggeber: signature(r.unterschriftAuftraggeber, 'unterschriftAuftraggeber'),
        unterschriftLansing: signature(r.unterschriftLansing, 'unterschriftLansing'),
        auftraggeberEmail: email(r.auftraggeberEmail),
        fotos,
    };
}

const CONTENT_TYPES: Record<ReportFileKind, string> = { pdf: 'application/pdf', photo: 'image/jpeg' };

export function parseCreateRequest(value: Record<string, unknown>): CreateReportRequest {
    const clientId = requireString(value.clientId, 'clientId', 64);
    if (!/^[A-Za-z0-9-]{8,64}$/.test(clientId)) fail('clientId');
    const files = list(value.files, 'files', FORM_LIMITS.fotos + 1).map((entry, i) => {
        const o = requireObject(entry, `files.${i}`);
        const name = requireString(o.name, `files.${i}.name`, 40);
        if (!isAllowedFileName(name)) fail(`files.${i}.name`);
        const kind: ReportFileKind = name === PDF_NAME ? 'pdf' : 'photo';
        const size = o.size;
        if (typeof size !== 'number' || !Number.isInteger(size) || size <= 0 || size > MAX_FILE_BYTES) {
            fail(`files.${i}.size`, 'Eine Datei ist leer oder zu groß.');
        }
        return { name, kind, contentType: CONTENT_TYPES[kind], size };
    });
    if (new Set(files.map((f) => f.name)).size !== files.length) fail('files', 'Doppelte Dateinamen.');
    if (!files.some((f) => f.kind === 'pdf')) fail('files', 'Das PDF fehlt.');
    const photos = files.filter((f) => f.kind === 'photo');
    photos.forEach((photo, i) => {
        if (photo.name !== photoFileName(i)) fail('files', 'Fotos müssen fortlaufend nummeriert sein.');
    });
    return { clientId, data: parseReportData(value.data, photos.length), files };
}

export function parseEmployees(value: unknown): string[] {
    const entries = list(value, 'employees', 200).map((name, i) => text(name, `employees.${i}`, 120)).filter(Boolean);
    return [...new Set(entries)].sort((a, b) => a.localeCompare(b, 'de'));
}
