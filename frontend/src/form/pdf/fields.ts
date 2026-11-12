/**
 * Feldpositionen des A4-Formulars (595 × 842 pt), übernommen aus V46 (`fields` in index.html).
 * Rechtecke: [x0, y0, x1, y1].
 */
export type Rect = [number, number, number, number];

export const PAGE = { width: 595, height: 842 };

export const HEAD = {
    projektnummer: [190, 76.4, 433, 90.4] as Rect,
    berichtNr: [489, 76.4, 551, 90.4] as Rect,
    bauvorhaben: [190, 97.4, 551, 111.4] as Rect,
    leitenderMonteur: [190, 118.4, 551, 132.4] as Rect,
    temperatur: [261.36, 151.48, 298.08, 163.0] as Rect,
    wetterSonstiges: [182, 184, 313, 199] as Rect,
    wochentag: [319, 170, 378, 198] as Rect,
    datum: [382, 170, 435, 198] as Rect,
    beginn: [440, 172, 491, 195] as Rect,
    ende: [496, 172, 550, 195] as Rect,
};

/** Wetter-Kästchen (Häkchen) und die zugehörigen Hintergrund-Rechtecke im SVG (x/y, Breite 53). */
export const WEATHER = {
    regen: { box: [105, 169, 112, 176] as Rect, svg: { x: 66, y: 167 } },
    frost: { box: [166, 169, 173, 176] as Rect, svg: { x: 127, y: 167 } },
    schnee: { box: [227, 169, 234, 176] as Rect, svg: { x: 187, y: 167 } },
    sonne: { box: [288, 169, 295, 176] as Rect, svg: { x: 248, y: 167 } },
    wind: { box: [105, 187, 112, 194] as Rect, svg: { x: 66, y: 185 } },
};

/** Mitarbeiter 1–4 links, 5–8 rechts. */
export const STAFF: Rect[] = [
    [86.4, 234.5, 317.52, 247],
    [86.4, 250.0, 317.52, 262.5],
    [86.4, 265.5, 317.52, 278],
    [86.4, 281.0, 317.52, 293.5],
    [334.8, 234.5, 551.52, 247],
    [335.52, 250.0, 552.24, 262.5],
    [335.52, 265.5, 552.24, 278],
    [335.52, 281.0, 552.24, 293.5],
];

const WORK_Y = [345.5, 360.0, 374.5, 389.0, 403.5, 418.0, 432.5, 447.0];
const LINE_H = 12.5;

/** Ausgeführte Arbeiten: 8 Zeilen mit Beschreibung, Bauteil, Geschoss, Ansicht. */
export const WORK = WORK_Y.map((y) => ({
    beschreibung: [69, y, 363, y + LINE_H] as Rect,
    bauteil: [367, y, 428, y + LINE_H] as Rect,
    geschoss: [432, y, 488, y + LINE_H] as Rect,
    ansicht: [492, y, 548, y + LINE_H] as Rect,
}));

const EXTRA_Y = [494.5, 509.0, 523.5, 538.0, 552.5, 567.0];

/** Zusätzliche Arbeiten: 6 Zeilen mit Beschreibung, Anzahl Mitarbeiter, Std./Person. */
export const EXTRA = EXTRA_Y.map((y) => ({
    beschreibung: [63, y, 410, y + LINE_H] as Rect,
    mitarbeiter: [414, y, 480, y + LINE_H] as Rect,
    stunden: [484, y, 548, y + LINE_H] as Rect,
}));

const EVENTS_Y = [633.5, 648.0, 662.5, 677.0, 691.5, 706.0];

/** Besondere Vorkommnisse: 6 Zeilen. */
export const EVENTS: Rect[] = EVENTS_Y.map((y) => [63, y, 548, y + LINE_H]);

/** Stunden gesamt: rechtsbündig in der Fußzeile der zusätzlichen Arbeiten. */
export const TOTAL_HOURS = { x: 545, y: 588.5 };

export const SIGNATURES = {
    auftraggeber: { rect: [127, 727, 230, 759] as Rect, name: { x: 65, y: 759, max: 60 } },
    lansing: { rect: [397, 727, 497, 759] as Rect, name: { x: 333, y: 759, max: 62 } },
};
