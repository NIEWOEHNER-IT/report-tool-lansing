/**
 * Zeilenumbruch für die festen Formularzeilen. Die Eingabe im chayns-Formular ist frei,
 * das A4-Blatt hat aber nur 8 / 6 / 6 Zeilen: lange Beschreibungen laufen in die Folgezeile.
 * Dieselbe Rechnung zeigt im Formular "PDF-Zeilen: x von y" an und begrenzt das Absenden.
 */
import { FORM_LIMITS, type ExtraRow, type WorkRow } from '../../../../shared/contract';
import { EVENTS, EXTRA, WORK, type Rect } from './fields';

/** Auflösung der Formularseite: 2000 px Breite (ca. 200 dpi), wie V46. */
export const SCALE = 2000 / 595;
export const FONT_FAMILY = 'Arial, Helvetica, sans-serif';
/** Schriftgrößen (px auf der 2000-px-Seite), größte zuerst; 30 px ≈ 9 pt. */
const FONT_STEPS = [30, 27, 24];
const PADDING = 16;

let measureCtx: CanvasRenderingContext2D | null = null;

function ctx(): CanvasRenderingContext2D {
    if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d')!;
    return measureCtx;
}

function widthOf(rect: Rect): number {
    return (rect[2] - rect[0]) * SCALE - PADDING;
}

/** Bricht Text in Zeilen der Breite `maxWidth` um (Absätze bleiben erhalten, lange Wörter werden geteilt). */
export function wrapText(text: string, maxWidth: number, fontSize: number): string[] {
    const c = ctx();
    c.font = `${fontSize}px ${FONT_FAMILY}`;
    const lines: string[] = [];
    for (const paragraph of text.split(/\r?\n/)) {
        const words = paragraph.trim().split(/\s+/).filter(Boolean);
        if (words.length === 0) continue;
        let line = '';
        for (const word of words) {
            const trial = line ? `${line} ${word}` : word;
            if (c.measureText(trial).width <= maxWidth) {
                line = trial;
                continue;
            }
            if (line) lines.push(line);
            // Einzelnes überlanges Wort zeichenweise teilen.
            let rest = word;
            while (c.measureText(rest).width > maxWidth && rest.length > 1) {
                let cut = rest.length - 1;
                while (cut > 1 && c.measureText(rest.slice(0, cut)).width > maxWidth) cut -= 1;
                lines.push(rest.slice(0, cut));
                rest = rest.slice(cut);
            }
            line = rest;
        }
        if (line) lines.push(line);
    }
    return lines;
}

export interface WorkLine {
    beschreibung: string;
    bauteil: string;
    geschoss: string;
    ansicht: string;
}

export interface ExtraLine {
    beschreibung: string;
    mitarbeiter: string;
    stunden: string;
}

export interface SectionLayout<T> {
    lines: T[];
    fontSize: number;
    used: number;
    max: number;
    fits: boolean;
}

function fitRows<R, L>(
    rows: R[],
    max: number,
    rect: Rect,
    text: (row: R) => string,
    first: (row: R, line: string) => L,
    follow: (line: string) => L,
): SectionLayout<L> {
    let best: SectionLayout<L> | null = null;
    for (const fontSize of FONT_STEPS) {
        const lines: L[] = [];
        for (const row of rows) {
            const wrapped = wrapText(text(row), widthOf(rect), fontSize);
            if (wrapped.length === 0) wrapped.push('');
            wrapped.forEach((line, i) => lines.push(i === 0 ? first(row, line) : follow(line)));
        }
        best = { lines, fontSize, used: lines.length, max, fits: lines.length <= max };
        if (best.fits) return best;
    }
    return best ?? { lines: [], fontSize: FONT_STEPS[0]!, used: 0, max, fits: true };
}

const hasWorkContent = (row: WorkRow) => !!(row.beschreibung.trim() || row.bauteil.trim() || row.geschoss.trim() || row.ansicht.trim());
const hasExtraContent = (row: ExtraRow) => !!(row.beschreibung.trim() || row.mitarbeiter.trim() || row.stunden.trim());

export function layoutWork(rows: WorkRow[]): SectionLayout<WorkLine> {
    return fitRows(
        rows.filter(hasWorkContent),
        FORM_LIMITS.arbeitenZeilen,
        WORK[0]!.beschreibung,
        (row) => row.beschreibung,
        (row, line) => ({ beschreibung: line, bauteil: row.bauteil, geschoss: row.geschoss, ansicht: row.ansicht }),
        (line) => ({ beschreibung: line, bauteil: '', geschoss: '', ansicht: '' }),
    );
}

export function layoutExtra(rows: ExtraRow[]): SectionLayout<ExtraLine> {
    return fitRows(
        rows.filter(hasExtraContent),
        FORM_LIMITS.zusatzZeilen,
        EXTRA[0]!.beschreibung,
        (row) => row.beschreibung,
        (row, line) => ({ beschreibung: line, mitarbeiter: row.mitarbeiter, stunden: row.stunden }),
        (line) => ({ beschreibung: line, mitarbeiter: '', stunden: '' }),
    );
}

export function layoutEvents(text: string): SectionLayout<string> {
    const paragraphs = text.trim() ? text.split(/\r?\n/).filter((p) => p.trim()) : [];
    return fitRows(
        paragraphs,
        FORM_LIMITS.vorkommnisseZeilen,
        EVENTS[0]!,
        (p) => p,
        (_p, line) => line,
        (line) => line,
    );
}
