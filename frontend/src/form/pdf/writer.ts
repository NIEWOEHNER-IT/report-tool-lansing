/**
 * Minimaler PDF-Writer (aus V46): je Seite ein JPEG in A4, keine Bibliothek, keine Formularfelder.
 */

export interface PageImage {
    bytes: Uint8Array;
    width: number;
    height: number;
}

export async function canvasToPageImage(canvas: HTMLCanvasElement, quality: number): Promise<PageImage> {
    const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Seite konnte nicht erzeugt werden.'))), 'image/jpeg', quality),
    );
    return { bytes: new Uint8Array(await blob.arrayBuffer()), width: canvas.width, height: canvas.height };
}

export function buildPdf(pages: PageImage[]): Blob {
    const enc = new TextEncoder();
    const chunks: Uint8Array[] = [];
    let offset = 0;
    const offsets: number[] = [0];
    const add = (value: string | Uint8Array) => {
        const bytes = typeof value === 'string' ? enc.encode(value) : value;
        chunks.push(bytes);
        offset += bytes.length;
    };
    const obj = (n: number, head: string, stream?: Uint8Array) => {
        offsets[n] = offset;
        add(`${n} 0 obj\n${head}`);
        if (stream) {
            add('\nstream\n');
            add(stream);
            add('\nendstream');
        }
        add('\nendobj\n');
    };

    add('%PDF-1.4\n');
    const kids = pages.map((_, i) => `${3 + i * 3} 0 R`).join(' ');
    obj(1, '<</Type/Catalog/Pages 2 0 R>>');
    obj(2, `<</Type/Pages/Kids[${kids}]/Count ${pages.length}>>`);
    pages.forEach((page, i) => {
        const n = 3 + i * 3;
        obj(n, `<</Type/Page/Parent 2 0 R/MediaBox[0 0 595.28 841.89]/Resources<</XObject<</Im0 ${n + 1} 0 R>>>>/Contents ${n + 2} 0 R>>`);
        obj(
            n + 1,
            `<</Type/XObject/Subtype/Image/Width ${page.width}/Height ${page.height}/ColorSpace/DeviceRGB/BitsPerComponent 8/Filter/DCTDecode/Length ${page.bytes.length}>>`,
            page.bytes,
        );
        const content = enc.encode('q\n595.28 0 0 841.89 0 0 cm\n/Im0 Do\nQ\n');
        obj(n + 2, `<</Length ${content.length}>>`, content);
    });
    const xref = offset;
    const count = 2 + pages.length * 3;
    add(`xref\n0 ${count + 1}\n0000000000 65535 f \n`);
    for (let i = 1; i <= count; i += 1) add(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`);
    add(`trailer\n<</Size ${count + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF`);
    return new Blob(chunks as BlobPart[], { type: 'application/pdf' });
}
