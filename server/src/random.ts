/** Zufall, Hashes und Signaturen (node:crypto). */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** Interne Kennung: 32 Hex-Zeichen. */
export function newId(): string {
    return randomBytes(16).toString('hex');
}

/** Sitzungstoken bzw. Nonce: 64 Hex-Zeichen. */
export function newSecret(): string {
    return randomBytes(32).toString('hex');
}

export function sha256(value: string): string {
    return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function hmacSha256(secret: string, message: string): string {
    return createHmac('sha256', secret).update(message, 'utf8').digest('hex');
}

/** Vergleich zweier Hex-Signaturen in konstanter Zeit. */
export function safeEqualHex(a: string, b: string): boolean {
    if (a.length !== b.length || a.length === 0 || !/^[0-9a-f]+$/i.test(a) || !/^[0-9a-f]+$/i.test(b)) return false;
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

export function nowIso(): string {
    return new Date().toISOString();
}
