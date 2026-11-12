/**
 * Lädt das Basis-Stylesheet der chayns-Site (Schriftart, Grundelemente, Absatzformate)
 * von style.tobit.cloud, genau wie chayns-toolkit es über CHAYNS_TOOLKIT_CSS_TAG tut
 * (Quelle: chayns-toolkit src/util/loadChaynsCss.ts, cssVersion 5.0 wie im
 * create-chayns-app-Template). Ohne dieses CSS gilt die Browser-Standardschrift.
 *
 * Aufrufreihenfolge: index.html startet den Loader früh mit der siteId aus den
 * URL-Parametern (chayns hängt sie an externe Seiten an); Root() ruft ihn erneut
 * mit der siteId aus chayns-api auf, falls kein Parameter vorhanden war. Der Link
 * wird nur einmal eingefügt.
 */

export const CHAYNS_CSS_VERSION = '5.0';
const LINK_ID = 'chayns-site-css';
const LOADING_CLASS = 'chayns-css-loading';
const LOAD_TIMEOUT_MS = 4000;

function buildUrl(siteId: string, colorMode?: string | null, color?: string | null): string {
    const url = new URL(`https://style.tobit.cloud/css/v${CHAYNS_CSS_VERSION}`);
    url.searchParams.set('siteId', siteId);
    if (colorMode) url.searchParams.set('colormode', colorMode);
    if (color) url.searchParams.set('color', color);
    return url.toString();
}

/** siteId aus den URL-Parametern (stylesiteid oder siteid), wie beim chayns-toolkit. */
export function getSiteIdFromLocation(): string | null {
    if (typeof window === 'undefined') return null;
    const params = new URLSearchParams(window.location.search.toLowerCase());
    return params.get('stylesiteid') || params.get('siteid') || null;
}

/**
 * Fügt das Stylesheet ein (einmalig) und blendet die Seite bis zum Laden aus.
 * Löst immer auf, auch bei Fehler oder Timeout, damit die App nie unsichtbar bleibt.
 */
export function ensureChaynsCss(siteId: string, colorMode?: string | null, color?: string | null): Promise<void> {
    if (typeof document === 'undefined') return Promise.resolve();
    const existing = document.getElementById(LINK_ID) as HTMLLinkElement | null;
    if (existing) {
        return existing.dataset.loaded === 'true' ? Promise.resolve() : waitFor(existing);
    }
    const link = document.createElement('link');
    link.id = LINK_ID;
    link.rel = 'stylesheet';
    link.type = 'text/css';
    link.href = buildUrl(siteId, colorMode, color);
    document.documentElement.classList.add(LOADING_CLASS);
    const done = waitFor(link);
    document.head.appendChild(link);
    return done;
}

function waitFor(link: HTMLLinkElement): Promise<void> {
    return new Promise((resolve) => {
        let settled = false;
        const finish = () => {
            if (settled) return;
            settled = true;
            link.dataset.loaded = 'true';
            document.documentElement.classList.remove(LOADING_CLASS);
            resolve();
        };
        link.addEventListener('load', finish);
        link.addEventListener('error', finish);
        window.setTimeout(finish, LOAD_TIMEOUT_MS);
    });
}
