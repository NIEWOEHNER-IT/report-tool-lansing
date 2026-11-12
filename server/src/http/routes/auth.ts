/** Bootstrap und Anmeldung. */
import { SERVER_API_VERSION, type BootstrapResponse, type BridgeAssertion, type MeResponse, type Role } from '../../../../shared/contract';
import { createSession, endSession, issueChallenge, verifyAssertion } from '../../auth';
import { ApiFailure } from '../../errors';
import { nowIso } from '../../random';
import { fail, requireObject, requireString } from '../../validate';
import { header } from '../respond';
import type { Route } from '../router';

function parseAssertion(value: unknown): BridgeAssertion {
    const record = requireObject(value, 'assertion');
    const groupIds = record.groupIds;
    if (!Array.isArray(groupIds) || groupIds.length > 1000 || !groupIds.every((id) => typeof id === 'number' && Number.isFinite(id))) {
        fail('assertion.groupIds');
    }
    const signature = requireString(record.signature, 'assertion.signature', 128);
    if (!/^[0-9a-fA-F]{64}$/.test(signature)) fail('assertion.signature');
    const personName = record.personName;
    return {
        personId: requireString(record.personId, 'assertion.personId', 64),
        personName: typeof personName === 'string' ? personName.slice(0, 200) : undefined,
        groupIds: groupIds as number[],
        nonce: requireString(record.nonce, 'assertion.nonce', 128),
        issuedAt: requireString(record.issuedAt, 'assertion.issuedAt', 40),
        signature,
    };
}

export const authRoutes: Route[] = [
    {
        method: 'GET',
        path: '/api/bootstrap',
        access: 'public',
        handler: ({ app }): BootstrapResponse => ({
            apiVersion: SERVER_API_VERSION,
            serverNow: nowIso(),
            bridgeUrl: app.config.bridgeUrl || null,
            devLoginEnabled: app.config.devLogin,
        }),
    },
    {
        method: 'POST',
        path: '/api/auth/challenge',
        access: 'public',
        limiter: 'auth',
        handler: ({ app }) => issueChallenge(app.store),
    },
    {
        method: 'POST',
        path: '/api/auth/session',
        access: 'public',
        limiter: 'auth',
        handler: async ({ app, body }) => {
            const assertion = parseAssertion((await body()).assertion);
            try {
                const session = verifyAssertion(app.store, app.config, assertion);
                app.logger.info('auth.login', { method: 'bridge', role: session.role, personId: session.personId });
                return session;
            } catch (err) {
                if (err instanceof ApiFailure) app.logger.warn('auth.rejected', { code: err.code, personId: assertion.personId });
                throw err;
            }
        },
    },
    {
        // Nur lokal mit DEV_LOGIN=true (nie in Produktion): Anmeldung ohne chayns für Tests.
        method: 'POST',
        path: '/api/auth/dev',
        access: 'public',
        limiter: 'auth',
        handler: async ({ app, body }) => {
            if (!app.config.devLogin) throw new ApiFailure('NOT_FOUND', 'Unbekannte Adresse.');
            const input = await body();
            const role: Role = input.role === 'admin' ? 'admin' : 'employee';
            const personId = typeof input.personId === 'string' && input.personId ? input.personId.slice(0, 64) : 'DEV-00001';
            const name = typeof input.personName === 'string' ? input.personName.slice(0, 120) : 'Test Monteur';
            app.logger.warn('auth.dev_login', { role, personId });
            return createSession(app.store, role, personId, name);
        },
    },
    {
        method: 'GET',
        path: '/api/auth/me',
        access: 'employee',
        handler: ({ session }): MeResponse => ({
            role: session!.role,
            personId: session!.personId,
            personName: session!.personName,
            expiresAt: session!.expiresAt,
        }),
    },
    {
        method: 'POST',
        path: '/api/auth/logout',
        access: 'public',
        handler: ({ app, req }) => {
            endSession(app.store, header(req, 'authorization'));
            return { ok: true };
        },
    },
];
