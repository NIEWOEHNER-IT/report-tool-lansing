/**
 * Ablage der Berichtsdateien im Volume: <dataDir>/files/<reportId>/<name>.
 * Dateinamen sind fest vorgegeben (bericht.pdf, foto-01.jpg …), Pfade daher nicht frei wählbar.
 */
import { createReadStream } from 'node:fs';
import { mkdir, open, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

export const PDF_NAME = 'bericht.pdf';
const PHOTO_PATTERN = /^foto-(\d{2})\.jpg$/;

export function isAllowedFileName(name: string): boolean {
    return name === PDF_NAME || PHOTO_PATTERN.test(name);
}

export function photoFileName(index: number): string {
    return `foto-${String(index + 1).padStart(2, '0')}.jpg`;
}

export class FileStore {
    constructor(private readonly dataDir: string) {}

    dirOf(reportId: string): string {
        if (!/^[0-9a-f]{32}$/.test(reportId)) throw new Error('Ungültige Bericht-Kennung');
        return join(this.dataDir, 'files', reportId);
    }

    pathOf(reportId: string, name: string): string {
        if (!isAllowedFileName(name)) throw new Error('Ungültiger Dateiname');
        return join(this.dirOf(reportId), name);
    }

    /** Schreibt ein Stück an `offset`; die Datei wird bei offset 0 neu angelegt. */
    async writeChunk(reportId: string, name: string, offset: number, chunk: Buffer): Promise<void> {
        await mkdir(this.dirOf(reportId), { recursive: true });
        const handle = await open(this.pathOf(reportId, name), offset === 0 ? 'w' : 'r+');
        try {
            await handle.write(chunk, 0, chunk.length, offset);
        } finally {
            await handle.close();
        }
    }

    /** Liest die ersten Bytes (Formatprüfung nach dem Upload). */
    async readHead(reportId: string, name: string, length: number): Promise<Buffer> {
        const handle = await open(this.pathOf(reportId, name), 'r');
        try {
            const buffer = Buffer.alloc(length);
            const { bytesRead } = await handle.read(buffer, 0, length, 0);
            return buffer.subarray(0, bytesRead);
        } finally {
            await handle.close();
        }
    }

    async sizeOf(reportId: string, name: string): Promise<number> {
        try {
            return (await stat(this.pathOf(reportId, name))).size;
        } catch {
            return 0;
        }
    }

    stream(reportId: string, name: string) {
        return createReadStream(this.pathOf(reportId, name));
    }

    async removeReport(reportId: string): Promise<void> {
        await rm(this.dirOf(reportId), { recursive: true, force: true });
    }
}
