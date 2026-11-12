/**
 * chayns.codes-Bridge des Bautagesberichts: die einzige Funktion auf der Lansing-Site.
 *
 * Warum: Der Container kann den chayns-Token des Browsers nicht selbst prüfen. Die Bridge
 * läuft im chayns-Kontext, kennt die aufrufende Person (Bearer-Token) und ihre UAC-Gruppen.
 *
 *  - assert: bestätigt Person + Gruppen signiert (HMAC mit dem Bridge-Secret). Der Browser
 *    reicht die Bestätigung an den Container weiter, der Signatur, Alter und Nonce prüft.
 *  - ai:     strukturiert diktierten Text mit chayns.ai.prompt. Nur für Mitglieder der
 *    erlaubten Gruppen (Team/Admin); kein Schlüssel im Container nötig.
 *
 * Trigger: HTTPS, Timeout in den Funktions-Einstellungen auf 60 s stellen (KI).
 * Platzhalter __BRIDGE_SECRET__ und __ALLOWED_GROUP_IDS__ setzt scripts/make-bridge.mjs.
 */
import {
    AI_MAX_TEXT_LENGTH,
    bridgeAssertionMessage,
    ERROR_MESSAGES_DE,
    type AiMode,
    type AiResult,
    type ApiResponse,
    type BridgeAssertion,
    type ErrorCode,
} from '../../shared/contract';
import { AI_CONFIG } from './prompts';
import { hmacHex } from './sha256';

export const BRIDGE_VERSION = 1;

export interface BridgeOptions {
    secret: string;
    /** Gruppen, deren Mitglieder die KI nutzen dürfen. */
    allowedGroupIds: number[];
}

type FunctionResult = { status: number; body: ApiResponse<unknown> };

function okResponse(data: unknown): FunctionResult {
    return { status: 200, body: { ok: true, data } };
}

function errorResponse(code: ErrorCode, message?: string): FunctionResult {
    return { status: 200, body: { ok: false, error: { code, message: message ?? ERROR_MESSAGES_DE[code] } } };
}

async function safeCall<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
    try {
        return await fn();
    } catch (err) {
        console.error('chayns-Aufruf fehlgeschlagen:', err);
        return fallback;
    }
}

/** chayns.codes reicht den Body je nach Trigger unterschiedlich verpackt durch. */
function unwrapRequest(request: unknown): Record<string, unknown> {
    if (!request || typeof request !== 'object') return {};
    const record = request as Record<string, unknown>;
    if (record.body && typeof record.body === 'object') return record.body as Record<string, unknown>;
    if (typeof record.body === 'string') {
        try {
            const parsed = JSON.parse(record.body) as unknown;
            if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>;
        } catch {
            return {};
        }
    }
    return record;
}

async function currentPerson(): Promise<{ personId: string; groupIds: number[] } | null> {
    const personId = await safeCall(() => chayns.person.current.getId(), '');
    if (!personId) return null;
    const groups = await safeCall(() => chayns.person.current.getUacGroups(), []);
    const groupIds = groups.map((group) => Number(group.id)).filter((id) => Number.isFinite(id));
    return { personId, groupIds };
}

async function personName(personId: string): Promise<string | undefined> {
    const info = await safeCall(() => chayns.person.getPublicInformation(personId), {});
    const name = [info.firstName, info.lastName].filter(Boolean).join(' ').trim();
    return name || undefined;
}

async function handleAssert(options: BridgeOptions, payload: Record<string, unknown>): Promise<FunctionResult> {
    const nonce = typeof payload.nonce === 'string' ? payload.nonce : '';
    if (!nonce || nonce.length > 128) return errorResponse('VALIDATION_ERROR', 'Nonce fehlt.');
    const person = await currentPerson();
    if (!person) return errorResponse('NOT_AUTHENTICATED');
    const fields = { personId: person.personId, groupIds: person.groupIds, nonce, issuedAt: new Date().toISOString() };
    const assertion: BridgeAssertion = {
        ...fields,
        personName: await personName(person.personId),
        signature: hmacHex(options.secret, bridgeAssertionMessage(fields)),
    };
    return okResponse(assertion);
}

function str(value: unknown, max = 500): string {
    return typeof value === 'string' ? value.trim().slice(0, max) : typeof value === 'number' ? String(value) : '';
}

/** Antwort der KI defensiv in das erwartete Format bringen (auch wenn Codeblöcke drumherum stehen). */
export function parseAiAnswer(mode: AiMode, raw: string): AiResult {
    const match = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw);
    let parsed: unknown;
    try {
        parsed = JSON.parse(match ? match[1]! : raw);
    } catch {
        throw new Error('KI-Antwort ist kein JSON');
    }
    const record = (parsed && typeof parsed === 'object' ? parsed : {}) as Record<string, unknown>;
    if (mode === 'photo') return { rows: [], text: str(record.text, 1200) };
    const rows = Array.isArray(record.rows) ? record.rows : [];
    const limit = AI_CONFIG[mode].maxRows;
    return {
        rows: rows.slice(0, limit).map((row) => {
            const r = (row && typeof row === 'object' ? row : {}) as Record<string, unknown>;
            if (mode === 'work') {
                return { beschreibung: str(r.beschreibung), bauteil: str(r.bauteil, 60), geschoss: str(r.geschoss, 30), ansicht: str(r.ansicht, 30) };
            }
            if (mode === 'extra') {
                return { beschreibung: str(r.beschreibung), mitarbeiter: str(r.mitarbeiter, 10), stunden: str(r.stunden, 10) };
            }
            return { beschreibung: str(r.beschreibung) };
        }).filter((row) => row.beschreibung),
    };
}

async function handleAi(options: BridgeOptions, payload: Record<string, unknown>): Promise<FunctionResult> {
    const mode = payload.mode as AiMode;
    if (!(mode in AI_CONFIG)) return errorResponse('VALIDATION_ERROR', 'Unbekannter Modus.');
    const text = typeof payload.text === 'string' ? payload.text.trim() : '';
    if (!text) return errorResponse('VALIDATION_ERROR', 'Kein Text übergeben.');
    if (text.length > AI_MAX_TEXT_LENGTH) return errorResponse('VALIDATION_ERROR', 'Der Text ist zu lang.');
    const person = await currentPerson();
    if (!person) return errorResponse('NOT_AUTHENTICATED');
    if (!person.groupIds.some((id) => options.allowedGroupIds.includes(id))) return errorResponse('FORBIDDEN');
    const config = AI_CONFIG[mode];
    try {
        const raw = await chayns.ai.prompt(text, { prePrompt: config.prePrompt, jsonResponseScheme: config.schema });
        return okResponse(parseAiAnswer(mode, String(raw)));
    } catch (err) {
        console.error('KI-Fehler:', err);
        return errorResponse('AI_FAILED');
    }
}

export function createBridge(options: BridgeOptions): (request: unknown) => Promise<FunctionResult> {
    return async (request: unknown) => {
        try {
            const input = unwrapRequest(request);
            const action = typeof input.action === 'string' ? input.action : '';
            const payload = (typeof input.payload === 'object' && input.payload !== null ? input.payload : {}) as Record<string, unknown>;
            switch (action) {
                case 'assert':
                    return await handleAssert(options, payload);
                case 'ai':
                    return await handleAi(options, payload);
                case 'ping': {
                    const siteId = await safeCall(() => chayns.sites.current.getId(), '');
                    return okResponse({ version: BRIDGE_VERSION, siteId });
                }
                default:
                    return errorResponse('VALIDATION_ERROR', 'Unbekannte Aktion.');
            }
        } catch (err) {
            console.error('Bridge-Fehler:', err);
            return errorResponse('INTERNAL_ERROR');
        }
    };
}

function parseGroupIds(text: string): number[] {
    return text
        .split(',')
        .map((part) => Number(part.trim()))
        .filter((id) => Number.isInteger(id) && id > 0);
}

// Die Platzhalter ersetzt scripts/make-bridge.mjs.
export default createBridge({ secret: '__BRIDGE_SECRET__', allowedGroupIds: parseGroupIds('__ALLOWED_GROUP_IDS__') });
