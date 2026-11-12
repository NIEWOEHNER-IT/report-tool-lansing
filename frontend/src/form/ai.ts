/**
 * KI-Überarbeitung diktierter Texte über die chayns.codes-Bridge (chayns.ai.prompt).
 * Im lokalen Mock-Modus gibt es keine Bridge: dann wird der Text satzweise aufgeteilt.
 */
import type { AiMode, AiResult } from '../../../shared/contract';
import { callBridge } from '../common/api';
import { isMockMode } from '../common/mockMode';

function localFallback(mode: AiMode, text: string): AiResult {
    if (mode === 'photo') return { rows: [], text: text.trim() };
    const sentences = text
        .split(/\n+|(?<=[.!?])\s+/)
        .map((s) => s.replace(/^[-*]\s*/, '').trim())
        .filter(Boolean);
    return { rows: sentences.map((beschreibung) => ({ beschreibung })) };
}

export async function structureText(bridgeUrl: string | null, mode: AiMode, text: string): Promise<AiResult> {
    if (isMockMode() || !bridgeUrl) return localFallback(mode, text);
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 60_000);
    try {
        return await callBridge<AiResult>(bridgeUrl, 'ai', { mode, text }, controller.signal);
    } finally {
        window.clearTimeout(timer);
    }
}
