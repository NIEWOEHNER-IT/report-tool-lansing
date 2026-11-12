/**
 * API-Vertrag zwischen Formular, Admin-Bereich, chayns.codes-Bridge und Container.
 * Wird von allen Teilen importiert; keine Laufzeitabhängigkeiten.
 */

export const SERVER_API_VERSION = 1;

/** UAC-Gruppe "Team" der Lansing-Site: darf Berichte anlegen. */
export const DEFAULT_UAC_GROUP_TEAM = 79077;
/** Admin-Bereich: UAC-Gruppe "Bautagebuch Admin". Per UAC_GROUP_ADMIN änderbar. */
export const DEFAULT_UAC_GROUP_ADMIN = 223675;
/** chayns-Manager der Site haben immer Admin-Zugang, unabhängig von UAC_GROUP_ADMIN. */
export const CHAYNS_MANAGER_GROUP = 1;

/** Sitzung im localStorage (je Origin, also für Formular und Admin gemeinsam). */
export const SESSION_STORAGE_KEY = 'lansing-bautagesbericht-session-v1';

/** Max. Alter einer Bridge-Bestätigung. */
export const ASSERTION_MAX_AGE_SECONDS = 120;

/**
 * Größe eines Upload-Stücks. Bewusst klein: nginx-proxy lässt ohne eigene vhost-Einstellung
 * nur 1 MB pro Anfrage zu, und auf der Baustelle muss bei Abbruch nur ein Stück wiederholt werden.
 */
export const UPLOAD_CHUNK_BYTES = 512 * 1024;

export type Role = 'employee' | 'admin';

// ---------------------------------------------------------------------------
// Fehler und Antworthülle
// ---------------------------------------------------------------------------

export const ErrorCodes = {
    VALIDATION_ERROR: 'VALIDATION_ERROR',
    NOT_AUTHENTICATED: 'NOT_AUTHENTICATED',
    SESSION_EXPIRED: 'SESSION_EXPIRED',
    FORBIDDEN: 'FORBIDDEN',
    NOT_FOUND: 'NOT_FOUND',
    CONFLICT: 'CONFLICT',
    BRIDGE_REJECTED: 'BRIDGE_REJECTED',
    RATE_LIMITED: 'RATE_LIMITED',
    PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
    AI_FAILED: 'AI_FAILED',
    INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

export const ERROR_MESSAGES_DE: Record<ErrorCode, string> = {
    VALIDATION_ERROR: 'Die Eingaben sind unvollständig oder ungültig.',
    NOT_AUTHENTICATED: 'Bitte in chayns anmelden.',
    SESSION_EXPIRED: 'Die Sitzung ist abgelaufen. Bitte die Seite neu laden.',
    FORBIDDEN: 'Für diese Aktion fehlt die Berechtigung.',
    NOT_FOUND: 'Der Eintrag wurde nicht gefunden.',
    CONFLICT: 'Der Vorgang passt nicht zum aktuellen Stand. Bitte erneut versuchen.',
    BRIDGE_REJECTED: 'Die Anmeldung über chayns konnte nicht bestätigt werden.',
    RATE_LIMITED: 'Zu viele Anfragen. Bitte kurz warten.',
    PAYLOAD_TOO_LARGE: 'Die Daten sind zu groß.',
    AI_FAILED: 'Die KI-Überarbeitung ist fehlgeschlagen. Bitte den Text selbst übernehmen.',
    INTERNAL_ERROR: 'Ein technischer Fehler ist aufgetreten. Bitte später erneut versuchen.',
};

export interface ApiError {
    code: ErrorCode;
    message: string;
    fields?: string[];
}

export type ApiResponse<T> = { ok: true; data: T } | { ok: false; error: ApiError };

// ---------------------------------------------------------------------------
// Anmeldung
// ---------------------------------------------------------------------------

export interface BootstrapResponse {
    apiVersion: number;
    serverNow: string;
    bridgeUrl: string | null;
    /** Nur lokal (DEV_LOGIN=true): Anmeldung ohne chayns für Tests. */
    devLoginEnabled: boolean;
}

export interface ChallengeResponse {
    nonce: string;
    expiresAt: string;
}

export interface BridgeAssertionFields {
    personId: string;
    groupIds: number[];
    nonce: string;
    issuedAt: string;
}

export interface BridgeAssertion extends BridgeAssertionFields {
    personName?: string;
    signature: string;
}

/** Signierter Text: feste Reihenfolge, Gruppen sortiert. */
export function bridgeAssertionMessage(fields: BridgeAssertionFields): string {
    const groups = [...fields.groupIds].sort((a, b) => a - b).join(',');
    return ['bautagesbericht-v1', fields.personId, groups, fields.nonce, fields.issuedAt].join('|');
}

export interface SessionResponse {
    token: string;
    expiresAt: string;
    role: Role;
    personId: string;
    personName: string | null;
}

export interface MeResponse {
    role: Role;
    personId: string;
    personName: string | null;
    expiresAt: string;
}

// ---------------------------------------------------------------------------
// Bericht
// ---------------------------------------------------------------------------

/** Kapazität des A4-Formulars (Zeilen im PDF). */
export const FORM_LIMITS = {
    mitarbeiter: 8,
    arbeitenZeilen: 8,
    zusatzZeilen: 6,
    vorkommnisseZeilen: 6,
    fotos: 30,
} as const;

export interface WeatherFlags {
    regen: boolean;
    frost: boolean;
    schnee: boolean;
    sonne: boolean;
    wind: boolean;
}

export interface WorkRow {
    beschreibung: string;
    bauteil: string;
    geschoss: string;
    ansicht: string;
}

export interface ExtraRow {
    beschreibung: string;
    /** Anzahl Mitarbeiter (Text, wie im Formular). */
    mitarbeiter: string;
    /** Stunden je Person. */
    stunden: string;
}

export interface SignatureData {
    name: string;
    /** PNG als data:-URL, null = nicht unterschrieben. */
    image: string | null;
}

export interface PhotoMeta {
    /** Dateiname im Upload, z. B. foto-01.jpg */
    file: string;
    caption: string;
}

export interface ReportData {
    projektnummer: string;
    berichtNr: string;
    bauvorhaben: string;
    leitenderMonteur: string;
    /** JJJJ-MM-TT */
    datum: string;
    /** HH:MM */
    beginn: string;
    ende: string;
    wetter: WeatherFlags;
    temperatur: string;
    wetterSonstiges: string;
    baustellenort: string;
    mitarbeiter: string[];
    arbeiten: WorkRow[];
    zusatzAufAnweisung: boolean;
    zusatz: ExtraRow[];
    vorkommnisse: string;
    unterschriftAuftraggeber: SignatureData;
    unterschriftLansing: SignatureData;
    /** Leer = keine Kopie. Sonst erhält der Auftraggeber das PDF per E-Mail. */
    auftraggeberEmail: string;
    fotos: PhotoMeta[];
}

export type ReportFileKind = 'pdf' | 'photo';

export interface ReportFileInfo {
    name: string;
    kind: ReportFileKind;
    contentType: string;
    size: number;
}

export interface CreateReportRequest {
    /** Vom Gerät erzeugte Kennung des Entwurfs: macht das Absenden wiederholbar. */
    clientId: string;
    data: ReportData;
    files: { name: string; kind: ReportFileKind; contentType: string; size: number }[];
}

export interface UploadState {
    name: string;
    size: number;
    received: number;
}

export interface CreateReportResponse {
    id: string;
    status: ReportStatus;
    chunkBytes: number;
    files: UploadState[];
}

export type ReportStatus = 'uploading' | 'complete';

/** none = keine Kopie gewünscht, pending = wartet auf Versand, sent, failed = endgültig fehlgeschlagen. */
export type MailStatus = 'none' | 'pending' | 'sent' | 'failed';

export interface MailInfo {
    status: MailStatus;
    to: string;
    sentAt: string | null;
    error: string | null;
    attempts: number;
}

/** Einfache Prüfung einer E-Mail-Adresse (Format, keine Zustellbarkeit). */
export function isValidEmail(value: string): boolean {
    return value.length <= 200 && /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]{2,}$/.test(value);
}

export interface ReportSummary {
    id: string;
    status: ReportStatus;
    projektnummer: string;
    berichtNr: string;
    bauvorhaben: string;
    leitenderMonteur: string;
    datum: string;
    /** ISO-Woche, z. B. 2026-W46 */
    isoWeek: string;
    createdAt: string;
    createdBy: { personId: string; name: string | null };
    photoCount: number;
    pdfSize: number;
    mail: MailInfo;
}

export interface ReportDetail extends ReportSummary {
    data: ReportData;
    files: ReportFileInfo[];
}

export interface ReportListResponse {
    from: string;
    to: string;
    reports: ReportSummary[];
}

export interface SettingsResponse {
    employees: string[];
}

// ---------------------------------------------------------------------------
// KI (über die Bridge)
// ---------------------------------------------------------------------------

export type AiMode = 'work' | 'extra' | 'events' | 'photo';

export interface AiRequest {
    mode: AiMode;
    text: string;
}

export interface AiResult {
    /** work: WorkRow, extra: ExtraRow, events: { beschreibung } */
    rows: Array<Partial<WorkRow & ExtraRow>>;
    /** photo: überarbeitete Bildbeschreibung */
    text?: string;
}

export const AI_MAX_TEXT_LENGTH = 4000;

// ---------------------------------------------------------------------------
// Datum
// ---------------------------------------------------------------------------

/** JJJJ-MM-TT eines Datums in lokaler Zeit. */
export function toDayKey(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function isValidDayKey(value: string): boolean {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [y, m, d] = value.split('-').map(Number) as [number, number, number];
    const date = new Date(Date.UTC(y, m - 1, d));
    return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** ISO-Woche zu einem Tag (JJJJ-MM-TT), z. B. "2026-W46". */
export function isoWeekOf(dayKey: string): string {
    const [y, m, d] = dayKey.split('-').map(Number) as [number, number, number];
    const t = new Date(Date.UTC(y, m - 1, d));
    const dayNum = t.getUTCDay() || 7;
    t.setUTCDate(t.getUTCDate() + 4 - dayNum);
    const jan1 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
    const week = Math.ceil(((t.getTime() - jan1.getTime()) / 86400000 + 1) / 7);
    return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** Montag bis Sonntag der Woche, in der `date` liegt (lokale Zeit). */
export function weekRangeOf(date: Date): { start: Date; end: Date } {
    const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const offset = (start.getDay() + 6) % 7;
    start.setDate(start.getDate() - offset);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    return { start, end };
}

export const WEEKDAYS_DE = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];

/** "Mittwoch" zu JJJJ-MM-TT. */
export function weekdayOf(dayKey: string): string {
    if (!isValidDayKey(dayKey)) return '';
    const [y, m, d] = dayKey.split('-').map(Number) as [number, number, number];
    return WEEKDAYS_DE[new Date(y, m - 1, d).getDay()] ?? '';
}

/** TT.MM.JJJJ */
export function formatDayKey(dayKey: string): string {
    if (!isValidDayKey(dayKey)) return dayKey;
    const [y, m, d] = dayKey.split('-');
    return `${d}.${m}.${y}`;
}

/** Dateiname des PDFs wie in V46: JJJJ-MM-TT_Projekt_Nr.pdf */
export function pdfFileName(data: Pick<ReportData, 'datum' | 'projektnummer' | 'berichtNr'>): string {
    return `${data.datum}_${data.projektnummer}_${data.berichtNr.padStart(2, '0')}.pdf`;
}
