/**
 * Anmeldeablauf beider Frontends:
 *  1. GET /api/bootstrap
 *  2. gespeicherte Sitzung per GET /api/auth/me prüfen
 *  3. sonst Challenge -> Bridge (chayns-Token) -> POST /api/auth/session
 *  4. Mock-Modus (nur localhost): POST /api/auth/dev
 */
import type { BootstrapResponse, BridgeAssertion, ChallengeResponse, MeResponse, Role, SessionResponse } from '../../../shared/contract';
import {
    ApiClientError,
    apiUrl,
    authRequest,
    callBridge,
    clearSession,
    getSession,
    isAuthError,
    publicRequest,
    resolveAccessToken,
    storeSession,
} from './api';
import { getMockRole, isMockMode } from './mockMode';

export interface Identity {
    role: Role;
    personId: string;
    personName: string | null;
}

export type LoginOutcome =
    | { kind: 'ok'; bootstrap: BootstrapResponse; identity: Identity }
    | { kind: 'not-logged-in'; bootstrap: BootstrapResponse }
    | { kind: 'not-configured'; bootstrap: BootstrapResponse }
    | { kind: 'forbidden'; bootstrap: BootstrapResponse; message: string };

function identityOf(session: SessionResponse | MeResponse): Identity {
    return { role: session.role, personId: session.personId, personName: session.personName };
}

/**
 * In chayns wird bei JEDEM Öffnen der Seite frisch über die Bridge geprüft, wer angemeldet ist und
 * in welchen UAC-Gruppen die Person ist. Eine im Gerät gemerkte Sitzung wird nicht übernommen:
 * sonst könnte nach einem chayns-Logout auf einem geteilten iPad die nächste Person sie weiter
 * nutzen, und wer aus der Gruppe Team entfernt wurde, hätte bis zum Ablauf noch Zugriff.
 * Nur im lokalen Mock-Modus (ohne Bridge) wird eine gemerkte Test-Sitzung weiterverwendet.
 */
export async function login(requiredRole: Role = 'employee'): Promise<LoginOutcome> {
    const bootstrap = await publicRequest<BootstrapResponse>('GET', '/api/bootstrap');
    if (!isMockMode()) {
        await endStoredSession();
    } else if (getSession()) {
        try {
            const me = await authRequest<MeResponse>('GET', '/api/auth/me');
            const roleOk = requiredRole !== 'admin' || me.role === 'admin';
            if (roleOk && (!isMockMode() || me.role === getMockRole())) return { kind: 'ok', bootstrap, identity: identityOf(me) };
            clearSession();
        } catch (err) {
            if (!isAuthError(err)) throw err;
        }
    }
    if (isMockMode() && bootstrap.devLoginEnabled) {
        const role = getMockRole();
        const session = await publicRequest<SessionResponse>('POST', '/api/auth/dev', {
            role,
            personId: role === 'admin' ? 'DEV-ADMIN' : 'DEV-00001',
            personName: role === 'admin' ? 'Test Admin' : 'Test Monteur',
        });
        storeSession(session);
        return { kind: 'ok', bootstrap, identity: identityOf(session) };
    }
    if (!bootstrap.bridgeUrl) return { kind: 'not-configured', bootstrap };
    if (!(await resolveAccessToken())) return { kind: 'not-logged-in', bootstrap };
    try {
        const challenge = await publicRequest<ChallengeResponse>('POST', '/api/auth/challenge');
        const assertion = await callBridge<BridgeAssertion>(bootstrap.bridgeUrl, 'assert', { nonce: challenge.nonce });
        const session = await publicRequest<SessionResponse>('POST', '/api/auth/session', { assertion });
        storeSession(session);
        return { kind: 'ok', bootstrap, identity: identityOf(session) };
    } catch (err) {
        clearSession();
        if (err instanceof ApiClientError && err.code === 'FORBIDDEN') return { kind: 'forbidden', bootstrap, message: err.message };
        if (isAuthError(err)) return { kind: 'not-logged-in', bootstrap };
        throw err;
    }
}

/** Gemerkte Sitzung beim Server beenden und im Gerät löschen (Fehler egal). */
async function endStoredSession(): Promise<void> {
    const stored = getSession();
    clearSession();
    if (!stored) return;
    try {
        await fetch(apiUrl('/api/auth/logout'), { method: 'POST', headers: { Authorization: `Bearer ${stored.token}` } });
    } catch {
        // Sitzung läuft serverseitig ohnehin ab.
    }
}
