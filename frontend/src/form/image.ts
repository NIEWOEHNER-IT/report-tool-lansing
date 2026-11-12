/** Bildverarbeitung im Browser: Laden, Verkleinern, Zusammensetzen mit der Zeichenebene. */

export function loadImage(source: Blob | string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const url = typeof source === 'string' ? source : URL.createObjectURL(source);
        const img = new Image();
        img.onload = () => {
            if (typeof source !== 'string') URL.revokeObjectURL(url);
            resolve(img);
        };
        img.onerror = () => {
            if (typeof source !== 'string') URL.revokeObjectURL(url);
            reject(new Error('Bild konnte nicht geladen werden.'));
        };
        img.src = url;
    });
}

export function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
    return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Bild konnte nicht erzeugt werden.'))), type, quality);
    });
}

/** Foto auf höchstens `maxSide` Pixel verkleinern (JPEG). Hält Speicher und Upload klein. */
export async function resizePhoto(file: Blob, maxSide = 2000, quality = 0.85): Promise<Blob> {
    const img = await loadImage(file);
    const ratio = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * ratio);
    canvas.height = Math.round(img.naturalHeight * ratio);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvasToBlob(canvas, 'image/jpeg', quality);
}

/** Foto mit Zeichenebene zu einem JPEG zusammensetzen. */
export async function flattenPhoto(original: Blob, annotation: Blob | null, quality = 0.88): Promise<Blob> {
    if (!annotation) return original;
    const [base, layer] = await Promise.all([loadImage(original), loadImage(annotation)]);
    const canvas = document.createElement('canvas');
    canvas.width = base.naturalWidth;
    canvas.height = base.naturalHeight;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(base, 0, 0);
    ctx.drawImage(layer, 0, 0, canvas.width, canvas.height);
    return canvasToBlob(canvas, 'image/jpeg', quality);
}
