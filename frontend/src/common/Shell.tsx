/**
 * Gemeinsamer Rahmen beider Frontends: chayns-Provider, PageProvider mit Site-Design,
 * Anmeldung über die Bridge und Zugangsprüfung. Rendert `children(identity)` erst nach
 * erfolgreicher Anmeldung.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { ChaynsProvider, ColorMode, useSite } from 'chayns-api';
import { Button, PageProvider, SmallWaitCursor } from '@chayns-components/core';
import type { Role } from '../../../shared/contract';
import { getErrorMessage, onAuthLost } from './api';
import { ensureChaynsCss, getSiteIdFromLocation } from './chaynsCss';
import { useMockChayns } from './mockChayns';
import { isMockMode, MOCK_SITE_ID } from './mockMode';
import { Notice } from './Notice';
import { login, type Identity } from './session';
import type { BootstrapResponse } from '../../../shared/contract';
import './styles.css';

export interface ShellContext {
    identity: Identity;
    bootstrap: BootstrapResponse;
}

type State =
    | { kind: 'loading' }
    | { kind: 'message'; type: 'info' | 'error'; text: string; canRetry: boolean }
    | { kind: 'ready'; context: ShellContext };

interface GateProps {
    title: string;
    requiredRole: Role;
    children: (context: ShellContext) => ReactNode;
}

const NOT_LOGGED_IN = 'Bitte in chayns anmelden, um diese Seite zu öffnen.';

function Gate({ title, requiredRole, children }: GateProps) {
    const [state, setState] = useState<State>({ kind: 'loading' });

    const start = useCallback(async () => {
        setState({ kind: 'loading' });
        try {
            const outcome = await login(requiredRole);
            if (outcome.kind === 'ok') {
                if (requiredRole === 'admin' && outcome.identity.role !== 'admin') {
                    setState({ kind: 'message', type: 'info', text: 'Dieser Bereich ist nur für Administratoren freigegeben.', canRetry: false });
                    return;
                }
                setState({ kind: 'ready', context: { identity: outcome.identity, bootstrap: outcome.bootstrap } });
            } else if (outcome.kind === 'forbidden') {
                setState({ kind: 'message', type: 'info', text: outcome.message, canRetry: false });
            } else if (outcome.kind === 'not-configured') {
                setState({ kind: 'message', type: 'info', text: 'Die Anmeldung über chayns ist noch nicht eingerichtet.', canRetry: false });
            } else {
                setState({ kind: 'message', type: 'info', text: NOT_LOGGED_IN, canRetry: true });
            }
        } catch (err) {
            setState({ kind: 'message', type: 'error', text: getErrorMessage(err), canRetry: true });
        }
    }, [requiredRole]);

    useEffect(() => {
        void start();
    }, [start]);

    // Sitzung unterwegs verloren -> neu anmelden.
    const stateRef = useRef(state);
    stateRef.current = state;
    useEffect(
        () =>
            onAuthLost(() => {
                if (stateRef.current.kind === 'ready') void start();
            }),
        [start],
    );

    if (state.kind === 'loading') {
        return (
            <div className="loading-row">
                <SmallWaitCursor />
            </div>
        );
    }
    if (state.kind === 'message') {
        return (
            <div className="page">
                <h1>{title}</h1>
                <Notice type={state.type}>{state.text}</Notice>
                {state.canRetry && (
                    <div className="button-row">
                        <Button isSecondary icon="fa fa-rotate" onClick={() => void start()}>
                            Erneut versuchen
                        </Button>
                    </div>
                )}
            </div>
        );
    }
    return <>{children(state.context)}</>;
}

function Root(props: GateProps) {
    const site = useSite();
    useEffect(() => {
        if (site.id) void ensureChaynsCss(site.id, site.colorMode !== ColorMode.Classic ? String(site.colorMode) : null);
    }, [site.id, site.colorMode]);
    return (
        <PageProvider siteId={site.id || undefined} color={site.color} colorMode={site.colorMode}>
            <Gate {...props} />
        </PageProvider>
    );
}

function MockRoot(props: GateProps) {
    const { data, functions } = useMockChayns();
    return (
        <ChaynsProvider isModule data={data} functions={functions}>
            <div className="mock-banner">Lokale Vorschau ohne chayns (Test-Anmeldung)</div>
            <Root {...props} />
        </ChaynsProvider>
    );
}

/** Startet ein Frontend im Element #root (genau einmal). */
export function mountApp(props: GateProps): void {
    const container = document.getElementById('root');
    if (!container || container.dataset.mounted === 'true') return;
    container.dataset.mounted = 'true';
    const mock = isMockMode();
    if (mock) {
        const colorMode = new URLSearchParams(window.location.search).get('colormode');
        void ensureChaynsCss(MOCK_SITE_ID, colorMode);
    } else {
        const earlySiteId = getSiteIdFromLocation();
        if (earlySiteId) void ensureChaynsCss(earlySiteId);
    }
    createRoot(container).render(
        mock ? (
            <MockRoot {...props} />
        ) : (
            <ChaynsProvider>
                <Root {...props} />
            </ChaynsProvider>
        ),
    );
}
