/**
 * Anmeldung: Nonce, Bridge-Bestätigung (HMAC), Sitzungen, Rollen.
 *
 * Der Container kann den chayns-Token nicht selbst prüfen. Die chayns.codes-Bridge bestätigt
 * Person und UAC-Gruppen signiert; hier werden Signatur, Alter und die einmalige Nonce geprüft
 * und die Rolle aus den Gruppen abgeleitet (Admin vor Team; ohne passende Gruppe kein Zugang).
 */
import {
    ASSERTION_MAX_AGE_SECONDS,
    bridgeAssertionMessage,
    ErrorCodes,
    type BridgeAssertion,
    type ChallengeResponse,
    type Role,
    type SessionResponse,
} from '../../shared/contract';
import { CHALLENGE_TTL_MINUTES, SESSION_TTL_HOURS, type ServerConfig } from './config';
import type { SessionRecord, Store } from './db';
import { ApiFailure } from './errors';
import { hmacSha256, newSecret, nowIso, safeEqualHex, sha256 } from './random';

export function issueChallenge(store: Store): ChallengeResponse {
    const nonce = newSecret();
    const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MINUTES * 60_000).toISOString();
    store.insertChallenge(nonce, nowIso(), expiresAt);
    return { nonce, expiresAt };
}

export function createSession(store: Store, role: Role, personId: string, personName: string | null): SessionResponse {
    const token = newSecret();
    const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 3_600_000).toISOString();
    store.insertSession({ tokenHash: sha256(token), role, personId, personName, createdAt: nowIso(), expiresAt });
    return { token, expiresAt, role, personId, personName };
}

export function readBearer(header: string | undefined): string | null {
    if (!header) return null;
    const match = /^Bearer\s+([A-Za-z0-9._-]{1,200})$/i.exec(header.trim());
    return match?.[1] ?? null;
}

export function requireSession(store: Store, authorization: string | undefined): SessionRecord {
    const token = readBearer(authorization);
    if (!token) throw new ApiFailure(ErrorCodes.NOT_AUTHENTICATED);
    const tokenHash = sha256(token);
    const session = store.getSession(tokenHash);
    if (!session) throw new ApiFailure(ErrorCodes.NOT_AUTHENTICATED);
    if (Date.parse(session.expiresAt) <= Date.now()) {
        store.deleteSession(tokenHash);
        throw new ApiFailure(ErrorCodes.SESSION_EXPIRED);
    }
    return session;
}

export function endSession(store: Store, authorization: string | undefined): void {
    const token = readBearer(authorization);
    if (token) store.deleteSession(sha256(token));
}

/** Rolle aus den UAC-Gruppen; null = keine Berechtigung. */
export function roleForGroups(groupIds: number[], config: ServerConfig): Role | null {
    if (groupIds.some((id) => config.adminGroupIds.includes(id))) return 'admin';
    if (groupIds.some((id) => config.teamGroupIds.includes(id))) return 'employee';
    return null;
}

function ageInSeconds(iso: string): number {
    const parsed = Date.parse(iso);
    if (Number.isNaN(parsed)) return Number.POSITIVE_INFINITY;
    return Math.abs(Date.now() - parsed) / 1000;
}

/**
 * Prüft die Bestätigung der Bridge und entwertet die Nonce. BRIDGE_REJECTED bei ungültiger
 * Signatur, abgelaufener oder benutzter Nonce; FORBIDDEN ohne passende Gruppe.
 */
export function verifyAssertion(store: Store, config: ServerConfig, assertion: BridgeAssertion): SessionResponse {
    if (!config.bridgeSecret) {
        throw new ApiFailure(ErrorCodes.BRIDGE_REJECTED, 'Die Anmeldung über chayns ist nicht eingerichtet (BRIDGE_SECRET fehlt).');
    }
    if (ageInSeconds(assertion.issuedAt) > ASSERTION_MAX_AGE_SECONDS) {
        throw new ApiFailure(ErrorCodes.BRIDGE_REJECTED, 'Die Bestätigung ist abgelaufen. Bitte die Seite neu laden.');
    }
    const expected = hmacSha256(
        config.bridgeSecret,
        bridgeAssertionMessage({
            personId: assertion.personId,
            groupIds: assertion.groupIds,
            nonce: assertion.nonce,
            issuedAt: assertion.issuedAt,
        }),
    );
    if (!safeEqualHex(expected, assertion.signature.toLowerCase())) {
        throw new ApiFailure(ErrorCodes.BRIDGE_REJECTED);
    }
    // Erst nach gültiger Signatur entwerten, damit fremde Versuche keine Nonce verbrauchen.
    if (!store.consumeChallenge(assertion.nonce, nowIso())) {
        throw new ApiFailure(ErrorCodes.BRIDGE_REJECTED, 'Der Anmeldeversuch ist abgelaufen. Bitte die Seite neu laden.');
    }
    const role = roleForGroups(assertion.groupIds, config);
    if (!role) {
        throw new ApiFailure(ErrorCodes.FORBIDDEN, 'Der Bautagesbericht ist nur für Mitglieder der Gruppe „Team“ freigegeben.');
    }
    return createSession(store, role, assertion.personId, assertion.personName?.trim() || null);
}
