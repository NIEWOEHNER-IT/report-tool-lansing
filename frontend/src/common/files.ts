/**
 * PDF/Fotos dem Nutzer geben: auf iPad/iPhone über das Teilen-Menü (wie V46), sonst Download.
 * Im iFrame der chayns-App ist beides vom Gerät abhängig; deshalb zusätzlich "Im Browser öffnen".
 */

export async function shareOrDownload(blob: Blob, fileName: string): Promise<void> {
    const file = new File([blob], fileName, { type: blob.type });
    const nav = navigator as Navigator & { canShare?: (data: { files: File[] }) => boolean };
    if (nav.canShare?.({ files: [file] })) {
        try {
            await navigator.share({ files: [file], title: fileName });
            return;
        } catch (err) {
            if (err instanceof DOMException && err.name === 'AbortError') return;
            // weiter mit Download
        }
    }
    downloadBlob(blob, fileName);
}

export function downloadBlob(blob: Blob, fileName: string): void {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.className = 'no-link-style';
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Öffnet die Datei in einem neuen Tab (Desktop). */
export function openBlob(blob: Blob): void {
    const url = URL.createObjectURL(blob);
    const opened = window.open(url, '_blank', 'noopener');
    if (!opened) downloadBlob(blob, 'bericht.pdf');
    window.setTimeout(() => URL.revokeObjectURL(url), 120_000);
}

export function humanSize(bytes: number): string {
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    return `${(bytes / 1024 / 1024).toLocaleString('de-DE', { maximumFractionDigits: 1 })} MB`;
}
