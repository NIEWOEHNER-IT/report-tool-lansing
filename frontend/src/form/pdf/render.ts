/**
 * Erzeugt das Berichts-PDF im Browser: Formularseite (SVG-Vorlage aus V46 + eingetragene Werte)
 * und je Foto eine Seite "Bilddokumentation". Gleiches Erscheinungsbild wie V46.
 */
import { formatDayKey, weekdayOf } from '../../../../shared/contract';
import { formatHours, totalExtraHours, type Draft } from '../draft';
import { loadImage } from '../image';
import { EVENTS, EXTRA, HEAD, PAGE, SIGNATURES, STAFF, TOTAL_HOURS, WEATHER, WORK, type Rect } from './fields';
import { FONT_FAMILY, layoutEvents, layoutExtra, layoutWork, SCALE } from './layout';
import { buildPdf, canvasToPageImage, type PageImage } from './writer';

export interface PdfPhoto {
    image: Blob;
    caption: string;
}

const PAGE_W = 2000;
const PAGE_H = Math.round((PAGE_W * PAGE.height) / PAGE.width);
const TEXT_COLOR = '#111';

let svgCache: string | null = null;

async function loadTemplate(): Promise<string> {
    if (svgCache) return svgCache;
    const response = await fetch(new URL('formular.svg', document.baseURI).toString());
    if (!response.ok) throw new Error('Die Formularvorlage konnte nicht geladen werden.');
    svgCache = await response.text();
    return svgCache;
}

/** Vorlage an den Bericht anpassen: Wetter-Hervorhebung, Überschrift, Fußzeile "Stunden gesamt". */
function prepareTemplate(svgText: string, draft: Draft, hasHours: boolean): string {
    const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
    const svg = doc.documentElement;
    const rects = Array.from(svg.querySelectorAll('rect'));
    for (const [key, info] of Object.entries(WEATHER)) {
        const rect = rects.find(
            (r) => Number(r.getAttribute('x')) === info.svg.x && Number(r.getAttribute('y')) === info.svg.y && Number(r.getAttribute('width')) === 53,
        );
        if (!rect) continue;
        const active = draft.wetter[key as keyof Draft['wetter']];
        rect.setAttribute('fill', active ? '#e4edf4' : '#ffffff');
        rect.setAttribute('stroke', active ? '#b4cadc' : '#e1e8ee');
    }
    if (draft.zusatzAufAnweisung) {
        const heading = Array.from(svg.querySelectorAll('text')).find((el) => el.textContent?.trim() === 'Zusätzliche Arbeiten');
        if (heading) heading.textContent = 'Zusätzliche Arbeiten auf Anweisung der Bauleitung';
    }
    if (!hasHours) {
        for (const el of Array.from(svg.children)) {
            const tag = el.tagName.toLowerCase();
            const isTotal =
                (tag === 'rect' && el.getAttribute('x') === '63' && el.getAttribute('y') === '581') ||
                (tag === 'path' && el.getAttribute('d') === 'M63 581H552') ||
                (tag === 'text' && el.textContent?.trim() === 'Stunden gesamt');
            if (isTotal) el.remove();
        }
    }
    return new XMLSerializer().serializeToString(svg);
}

/** Einzeiliger Text, Schrift wird bei Bedarf verkleinert (wie V46). */
function drawFitted(ctx: CanvasRenderingContext2D, rect: Rect, value: string, maxFont = 30): void {
    const text = value.trim();
    if (!text) return;
    const [x0, y0, x1, y1] = rect;
    const x = x0 * SCALE;
    const y = y0 * SCALE;
    const w = (x1 - x0) * SCALE;
    const h = (y1 - y0) * SCALE;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x + 6, y, w - 12, h);
    ctx.clip();
    let fontSize = Math.min(maxFont, h * 0.76);
    ctx.font = `${fontSize}px ${FONT_FAMILY}`;
    while (fontSize > 11 && ctx.measureText(text).width > w - 16) {
        fontSize -= 1;
        ctx.font = `${fontSize}px ${FONT_FAMILY}`;
    }
    ctx.fillStyle = TEXT_COLOR;
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + 8, y + h * 0.53);
    ctx.restore();
}

/** Bereits umbrochene Zeile mit fester Schriftgröße. */
function drawLine(ctx: CanvasRenderingContext2D, rect: Rect, text: string, fontSize: number): void {
    if (!text) return;
    const [x0, y0, x1, y1] = rect;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0 * SCALE + 6, y0 * SCALE, (x1 - x0) * SCALE - 12, (y1 - y0) * SCALE);
    ctx.clip();
    ctx.font = `${fontSize}px ${FONT_FAMILY}`;
    ctx.fillStyle = TEXT_COLOR;
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x0 * SCALE + 8, (y0 + (y1 - y0) * 0.53) * SCALE);
    ctx.restore();
}

function drawCheck(ctx: CanvasRenderingContext2D, rect: Rect): void {
    const x = rect[0] * SCALE;
    const y = rect[1] * SCALE;
    const h = (rect[3] - rect[1]) * SCALE;
    ctx.save();
    ctx.strokeStyle = TEXT_COLOR;
    ctx.lineWidth = 2.4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x + 1, y + h * 0.48);
    ctx.lineTo(x + 4, y + h * 0.82);
    ctx.lineTo(x + 10, y + 1);
    ctx.stroke();
    ctx.restore();
}

async function renderFormPage(draft: Draft): Promise<HTMLCanvasElement> {
    const work = layoutWork(draft.arbeiten);
    const extra = layoutExtra(draft.zusatz);
    const events = layoutEvents(draft.vorkommnisse);
    if (!work.fits) throw new Error(`Ausgeführte Arbeiten: zu viel Text (${work.used} von ${work.max} Zeilen).`);
    if (!extra.fits) throw new Error(`Zusätzliche Arbeiten: zu viel Text (${extra.used} von ${extra.max} Zeilen).`);
    if (!events.fits) throw new Error(`Besondere Vorkommnisse: zu viel Text (${events.used} von ${events.max} Zeilen).`);
    const hours = totalExtraHours(draft.zusatz);

    const svgText = prepareTemplate(await loadTemplate(), draft, hours !== null);
    const svgUrl = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' }));
    let background: HTMLImageElement;
    try {
        background = await loadImage(svgUrl);
    } finally {
        URL.revokeObjectURL(svgUrl);
    }

    const canvas = document.createElement('canvas');
    canvas.width = PAGE_W;
    canvas.height = PAGE_H;
    const ctx = canvas.getContext('2d', { alpha: false })!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, PAGE_W, PAGE_H);
    ctx.drawImage(background, 0, 0, PAGE_W, PAGE_H);

    drawFitted(ctx, HEAD.projektnummer, draft.projektnummer);
    drawFitted(ctx, HEAD.berichtNr, draft.berichtNr);
    drawFitted(ctx, HEAD.bauvorhaben, draft.bauvorhaben);
    drawFitted(ctx, HEAD.leitenderMonteur, draft.leitenderMonteur);
    drawFitted(ctx, HEAD.temperatur, draft.temperatur);
    drawFitted(ctx, HEAD.wetterSonstiges, draft.wetterSonstiges);
    drawFitted(ctx, HEAD.wochentag, weekdayOf(draft.datum));
    drawFitted(ctx, HEAD.datum, formatDayKey(draft.datum));
    drawFitted(ctx, HEAD.beginn, draft.beginn);
    drawFitted(ctx, HEAD.ende, draft.ende);
    for (const [key, info] of Object.entries(WEATHER)) {
        if (draft.wetter[key as keyof Draft['wetter']]) drawCheck(ctx, info.box);
    }
    draft.mitarbeiter.slice(0, STAFF.length).forEach((name, i) => drawFitted(ctx, STAFF[i]!, name));

    work.lines.forEach((line, i) => {
        const rects = WORK[i]!;
        drawLine(ctx, rects.beschreibung, line.beschreibung, work.fontSize);
        drawFitted(ctx, rects.bauteil, line.bauteil);
        drawFitted(ctx, rects.geschoss, line.geschoss);
        drawFitted(ctx, rects.ansicht, line.ansicht);
    });
    extra.lines.forEach((line, i) => {
        const rects = EXTRA[i]!;
        drawLine(ctx, rects.beschreibung, line.beschreibung, extra.fontSize);
        drawFitted(ctx, rects.mitarbeiter, line.mitarbeiter);
        drawFitted(ctx, rects.stunden, line.stunden);
    });
    if (hours !== null) {
        ctx.save();
        ctx.fillStyle = '#263a49';
        ctx.font = `bold ${Math.round(7 * SCALE)}px ${FONT_FAMILY}`;
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'right';
        ctx.fillText(formatHours(hours), TOTAL_HOURS.x * SCALE, TOTAL_HOURS.y * SCALE);
        ctx.restore();
    }
    events.lines.forEach((line, i) => drawLine(ctx, EVENTS[i]!, line, events.fontSize));

    // Unterschriften und Namen fest einzeichnen.
    const signatureItems = [
        { info: SIGNATURES.auftraggeber, data: draft.unterschriftAuftraggeber, name: draft.unterschriftAuftraggeber.name },
        { info: SIGNATURES.lansing, data: draft.unterschriftLansing, name: draft.leitenderMonteur },
    ];
    for (const item of signatureItems) {
        if (!item.data.image) continue;
        const img = await loadImage(item.data.image);
        const [sx0, sy0, sx1, sy1] = item.info.rect;
        ctx.drawImage(img, sx0 * SCALE, sy0 * SCALE, (sx1 - sx0) * SCALE, (sy1 - sy0) * SCALE);
        const name = item.name.trim();
        if (!name) continue;
        const { x, y, max } = item.info.name;
        ctx.save();
        let fontSize = 24;
        ctx.font = `${fontSize}px ${FONT_FAMILY}`;
        while (fontSize > 11 && ctx.measureText(name).width > max * SCALE) {
            fontSize -= 1;
            ctx.font = `${fontSize}px ${FONT_FAMILY}`;
        }
        ctx.beginPath();
        ctx.rect(x * SCALE, (y - 9) * SCALE, max * SCALE, 15 * SCALE);
        ctx.clip();
        ctx.fillStyle = '#35495b';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(name, x * SCALE, y * SCALE);
        ctx.restore();
    }
    return canvas;
}

function wrapCaption(ctx: CanvasRenderingContext2D, caption: string, maxWidth: number): string[] {
    const lines: string[] = [];
    let line = '';
    for (const word of caption.split(/\s+/).filter(Boolean)) {
        const trial = line ? `${line} ${word}` : word;
        if (ctx.measureText(trial).width > maxWidth && line) {
            lines.push(line);
            line = word;
        } else {
            line = trial;
        }
    }
    if (line) lines.push(line);
    return lines;
}

async function renderPhotoPage(draft: Draft, photo: PdfPhoto, index: number): Promise<HTMLCanvasElement> {
    const canvas = document.createElement('canvas');
    canvas.width = 1785;
    canvas.height = 2526;
    const ctx = canvas.getContext('2d', { alpha: false })!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#192c43';
    ctx.font = `bold 46px ${FONT_FAMILY}`;
    ctx.fillText('LANSING – Bilddokumentation', 100, 120);
    ctx.font = `28px ${FONT_FAMILY}`;
    ctx.fillText(`${draft.projektnummer} · Bericht ${draft.berichtNr} · Bild ${index + 1} · ${formatDayKey(draft.datum)}`, 100, 175);
    const img = await loadImage(photo.image);
    const box = { x: 100, y: 240, w: 1585, h: 1660 };
    const ratio = Math.min(box.w / img.naturalWidth, box.h / img.naturalHeight);
    const w = img.naturalWidth * ratio;
    const h = img.naturalHeight * ratio;
    ctx.drawImage(img, box.x + (box.w - w) / 2, box.y + (box.h - h) / 2, w, h);
    ctx.strokeStyle = '#ccd4df';
    ctx.lineWidth = 2;
    ctx.strokeRect(box.x, box.y, box.w, box.h);
    ctx.fillStyle = '#192c43';
    ctx.font = `bold 30px ${FONT_FAMILY}`;
    ctx.fillText('Bildbeschreibung', 100, 1980);
    ctx.font = `27px ${FONT_FAMILY}`;
    const lines = wrapCaption(ctx, photo.caption, 1580);
    if (lines.length > 9) throw new Error(`Die Beschreibung zu Bild ${index + 1} ist zu lang. Bitte kürzen.`);
    lines.forEach((line, i) => ctx.fillText(line, 100, 2035 + i * 43));
    return canvas;
}

/** Komplettes PDF (Formular + Fotoseiten). `onProgress` meldet erledigte Seiten. */
export async function renderReportPdf(draft: Draft, photos: PdfPhoto[], onProgress?: (done: number, total: number) => void): Promise<Blob> {
    const total = 1 + photos.length;
    const pages: PageImage[] = [];
    pages.push(await canvasToPageImage(await renderFormPage(draft), 0.92));
    onProgress?.(1, total);
    for (let i = 0; i < photos.length; i += 1) {
        pages.push(await canvasToPageImage(await renderPhotoPage(draft, photos[i]!, i), 0.88));
        onProgress?.(i + 2, total);
    }
    return buildPdf(pages);
}

/** Prüft, ob eine Fotobeschreibung auf die Fotoseite passt (max. 9 Zeilen). */
export function captionFits(caption: string): boolean {
    const ctx = document.createElement('canvas').getContext('2d')!;
    ctx.font = `27px ${FONT_FAMILY}`;
    return wrapCaption(ctx, caption, 1580).length <= 9;
}
