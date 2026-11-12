/**
 * Anweisungen und JSON-Schemata für chayns.ai.prompt, je Diktat-Modus.
 *
 * Der ursprüngliche Cloudflare-Worker (V46) lag nicht vor; die Regeln sind aus dem
 * Frontend-Code der V46 abgeleitet (Spalten, Geschoss-/Ansichtskürzel, Korrekturen im Diktat).
 */
import type { AiMode } from '../../shared/contract';

const COMMON = [
    'Du bereitest diktierte Angaben eines Monteurs von LANSING Metallbau für den Bautagesbericht auf.',
    'Regeln:',
    '- Nichts erfinden. Nur Angaben verwenden, die im Text stehen.',
    '- Sachlich, knapp, Fachbegriffe beibehalten, Rechtschreibung korrigieren, Füllwörter entfernen.',
    '- Korrekturen im Diktat ("nein", "Korrektur", "ich meine") anwenden: nur die korrigierte Angabe übernehmen.',
    '- Felder, die nicht genannt werden, als leeren Text "" ausgeben.',
    '- Antworte ausschließlich mit JSON nach dem vorgegebenen Schema.',
].join('\n');

const WORK = [
    COMMON,
    'Aufgabe: Zerlege den Text in einzelne ausgeführte Arbeiten (eine Zeile je Tätigkeit, höchstens 8).',
    'Spalten: beschreibung (Tätigkeit), bauteil (z. B. "Raum 2.14", "Achse 3", "Tür T05"), geschoss, ansicht.',
    'geschoss als Kürzel: UG, KG, EG, 1. OG, 2. OG, …, DG.',
    'ansicht nur Nord, Süd, Ost oder West (ggf. kombiniert wie "Nord-Ost").',
    'Gelten Geschoss oder Ansicht ausdrücklich für mehrere Tätigkeiten, bei jeder Zeile eintragen.',
].join('\n');

const EXTRA = [
    COMMON,
    'Aufgabe: Zerlege den Text in zusätzliche Arbeiten (eine Zeile je Tätigkeit, höchstens 6).',
    'Spalten: beschreibung, mitarbeiter (Anzahl Personen als Zahl), stunden (Stunden je Person als Zahl, Dezimalkomma erlaubt).',
].join('\n');

const EVENTS = [
    COMMON,
    'Aufgabe: Formuliere besondere Vorkommnisse (Behinderungen, Mängel, Wartezeiten, Anweisungen) als kurze, vollständige Sätze.',
    'Je Vorkommnis eine Zeile im Feld beschreibung, höchstens 6.',
].join('\n');

const PHOTO = [
    COMMON,
    'Aufgabe: Formuliere aus dem Text eine sachliche Bildbeschreibung für die Fotodokumentation (höchstens 3 Sätze) im Feld text.',
].join('\n');

const workRow = {
    type: 'object',
    properties: {
        beschreibung: { type: 'string' },
        bauteil: { type: 'string' },
        geschoss: { type: 'string' },
        ansicht: { type: 'string' },
    },
    required: ['beschreibung', 'bauteil', 'geschoss', 'ansicht'],
};

const extraRow = {
    type: 'object',
    properties: {
        beschreibung: { type: 'string' },
        mitarbeiter: { type: 'string' },
        stunden: { type: 'string' },
    },
    required: ['beschreibung', 'mitarbeiter', 'stunden'],
};

const textRow = {
    type: 'object',
    properties: { beschreibung: { type: 'string' } },
    required: ['beschreibung'],
};

function rowsSchema(item: unknown) {
    return { type: 'object', properties: { rows: { type: 'array', items: item } }, required: ['rows'] };
}

export const AI_CONFIG: Record<AiMode, { prePrompt: string; schema: unknown; maxRows: number }> = {
    work: { prePrompt: WORK, schema: rowsSchema(workRow), maxRows: 8 },
    extra: { prePrompt: EXTRA, schema: rowsSchema(extraRow), maxRows: 6 },
    events: { prePrompt: EVENTS, schema: rowsSchema(textRow), maxRows: 6 },
    photo: {
        prePrompt: PHOTO,
        schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
        maxRows: 0,
    },
};
