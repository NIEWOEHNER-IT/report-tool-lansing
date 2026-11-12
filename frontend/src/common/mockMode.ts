/**
 * Lokaler Mock-Modus: chayns-Host wird nachgestellt (mockChayns.ts), die Container-API ist echt
 * (lokaler Server mit DEV_LOGIN=true, Anmeldung über /api/auth/dev).
 *
 * Aktiv AUSSCHLIESSLICH auf localhost/127.0.0.1 mit ?mock=1. In chayns immer aus.
 *   role=admin|employee   Rolle der Test-Anmeldung (Standard employee)
 *   colormode=1|2         Dunkel-/Hellmodus
 */

/** Lansing-Site: Farben und Schrift kommen in der Vorschau von der echten Site. */
export const MOCK_SITE_ID = '99820-05034';

function readParam(name: string): string | null {
    try {
        return new URL(window.location.href).searchParams.get(name);
    } catch {
        return null;
    }
}

export function isMockMode(): boolean {
    if (typeof window === 'undefined') return false;
    const { hostname } = window.location;
    if (hostname !== 'localhost' && hostname !== '127.0.0.1') return false;
    return readParam('mock') === '1';
}

export function getMockRole(): 'admin' | 'employee' {
    return readParam('role') === 'admin' ? 'admin' : 'employee';
}
