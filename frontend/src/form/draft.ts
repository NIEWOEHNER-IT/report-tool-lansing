/**
 * Entwurf des Berichts im Gerät (localStorage). Fotos liegen separat in IndexedDB (photoStore.ts).
 * Die clientId macht das Absenden wiederholbar: Der Server setzt einen abgebrochenen Upload fort.
 */
import { toDayKey, type ExtraRow, type ReportData, type SignatureData, type WorkRow } from '../../../shared/contract';

const DRAFT_KEY = 'lansing-bautagesbericht-entwurf-v1';
const PLACES_KEY = 'lansing-bautagesbericht-orte-v1';

export interface DraftPhoto {
    id: string;
    caption: string;
    /** true, wenn eine Zeichnung (Apple Pencil) über dem Foto liegt. */
    annotated: boolean;
}

export interface Draft extends Omit<ReportData, 'fotos'> {
    clientId: string;
    photos: DraftPhoto[];
}

export function newClientId(): string {
    try {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    } catch {
        // unsicherer Kontext
    }
    return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`;
}

export const emptyWorkRow = (): WorkRow => ({ beschreibung: '', bauteil: '', geschoss: '', ansicht: '' });
export const emptyExtraRow = (): ExtraRow => ({ beschreibung: '', mitarbeiter: '', stunden: '' });
const emptySignature = (): SignatureData => ({ name: '', image: null });

export function emptyDraft(): Draft {
    return {
        clientId: newClientId(),
        projektnummer: '',
        berichtNr: '',
        bauvorhaben: '',
        leitenderMonteur: '',
        datum: toDayKey(new Date()),
        beginn: '',
        ende: '',
        wetter: { regen: false, frost: false, schnee: false, sonne: false, wind: false },
        temperatur: '',
        wetterSonstiges: '',
        baustellenort: '',
        mitarbeiter: [],
        arbeiten: [emptyWorkRow()],
        zusatzAufAnweisung: false,
        zusatz: [],
        vorkommnisse: '',
        unterschriftAuftraggeber: emptySignature(),
        unterschriftLansing: emptySignature(),
        auftraggeberEmail: '',
        photos: [],
    };
}

/** Folgebericht: Projekt, Team und Zeiten bleiben, Nr. + 1, Inhalt und Unterschriften leer. */
export function nextDraft(previous: Draft): Draft {
    const next = emptyDraft();
    const nr = Number.parseInt(previous.berichtNr, 10);
    return {
        ...next,
        projektnummer: previous.projektnummer,
        berichtNr: Number.isFinite(nr) ? String(nr + 1) : '',
        bauvorhaben: previous.bauvorhaben,
        leitenderMonteur: previous.leitenderMonteur,
        baustellenort: previous.baustellenort,
        mitarbeiter: [...previous.mitarbeiter],
        beginn: previous.beginn,
        ende: previous.ende,
    };
}

export function loadDraft(): Draft {
    try {
        const raw = window.localStorage.getItem(DRAFT_KEY);
        if (!raw) return emptyDraft();
        const stored = JSON.parse(raw) as Partial<Draft>;
        const base = emptyDraft();
        return {
            ...base,
            ...stored,
            wetter: { ...base.wetter, ...stored.wetter },
            unterschriftAuftraggeber: { ...base.unterschriftAuftraggeber, ...stored.unterschriftAuftraggeber },
            unterschriftLansing: { ...base.unterschriftLansing, ...stored.unterschriftLansing },
            arbeiten: Array.isArray(stored.arbeiten) && stored.arbeiten.length > 0 ? stored.arbeiten : base.arbeiten,
            zusatz: Array.isArray(stored.zusatz) ? stored.zusatz : [],
            mitarbeiter: Array.isArray(stored.mitarbeiter) ? stored.mitarbeiter : [],
            photos: Array.isArray(stored.photos) ? stored.photos : [],
            clientId: typeof stored.clientId === 'string' && stored.clientId ? stored.clientId : base.clientId,
        };
    } catch {
        return emptyDraft();
    }
}

export function saveDraft(draft: Draft): boolean {
    try {
        window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
        return true;
    } catch {
        return false;
    }
}

/** Baustellenort je Projektnummer merken (Wetterabruf beim nächsten Bericht). */
export function rememberPlace(projektnummer: string, place: string): void {
    if (!/^\d{7}$/.test(projektnummer) || !place.trim()) return;
    try {
        const map = JSON.parse(window.localStorage.getItem(PLACES_KEY) || '{}') as Record<string, string>;
        map[projektnummer] = place.trim();
        window.localStorage.setItem(PLACES_KEY, JSON.stringify(map));
    } catch {
        // optional
    }
}

export function placeForProject(projektnummer: string): string {
    try {
        const map = JSON.parse(window.localStorage.getItem(PLACES_KEY) || '{}') as Record<string, string>;
        return map[projektnummer] ?? '';
    } catch {
        return '';
    }
}

/** Zahl aus deutscher Eingabe ("1,5"). */
export function parseNumber(value: string): number {
    const n = Number(String(value || '').replace(',', '.'));
    return Number.isFinite(n) && n >= 0 ? n : 0;
}

/** Stunden gesamt der zusätzlichen Arbeiten (Mitarbeiter × Std./Person). */
export function totalExtraHours(rows: ExtraRow[]): number | null {
    if (!rows.some((row) => row.stunden.trim() !== '')) return null;
    return rows.reduce((sum, row) => sum + parseNumber(row.mitarbeiter) * parseNumber(row.stunden), 0);
}

export function formatHours(value: number): string {
    return value.toLocaleString('de-DE', { maximumFractionDigits: 2 });
}
