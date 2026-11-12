/**
 * Integrationstests des Containers (In-Prozess-HTTP, SQLite im Speicher, Dateien im Temp-Ordner).
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { bridgeAssertionMessage, type ReportData } from '../shared/contract';
import { createApp, type App } from '../server/src/app';
import { loadConfig } from '../server/src/config';
import { createRateLimiter } from '../server/src/http/rateLimit';
import { createLogger } from '../server/src/logger';
import { hmacSha256 } from '../server/src/random';
import { createBridge, parseAiAnswer } from '../bridge/src/bridge';
import { hmacHex } from '../bridge/src/sha256';
import type { MailTransport, OutgoingMail } from '../server/src/mail';

const SECRET = 'test-secret-0123456789abcdef0123456789abcdef';
const TEAM = 79077;
const ADMIN = 1;

let app: App;
let base = '';
let dataDir = '';

const unlimited = () => createRateLimiter({ name: 't', windowMs: 1000, max: 1_000_000 });

/** Mail-Attrappe: merkt sich Mails, kann Fehler simulieren. */
const sentMails: OutgoingMail[] = [];
let mailFailure: Error | null = null;
const fakeTransport: MailTransport = {
    async send(mail) {
        if (mailFailure) throw mailFailure;
        sentMails.push(mail);
    },
};

before(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'btb-test-'));
    const config = {
        ...loadConfig({
            DATA_DIR: dataDir,
            BRIDGE_SECRET: SECRET,
            BRIDGE_URL: 'https://example.invalid/bridge',
            PORT: '0',
            SMTP_HOST: 'smtp.example.invalid',
            SMTP_USER: 'noreply@example.invalid',
            MAIL_REPLY_TO: 'buero@example.invalid',
        } as NodeJS.ProcessEnv),
        dbPath: ':memory:',
    };
    app = createApp(config, {
        logger: createLogger('silent'),
        limiters: { auth: unlimited(), api: unlimited(), upload: unlimited() },
        mailTransport: fakeTransport,
    });
    const port = await app.start();
    base = `http://127.0.0.1:${port}`;
});

after(async () => {
    await app.stop();
    rmSync(dataDir, { recursive: true, force: true });
});

async function api<T = any>(method: string, path: string, body?: unknown, token?: string): Promise<{ status: number; json: any; data: T }> {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const json = await res.json();
    return { status: res.status, json, data: json.data };
}

async function login(personId: string, groupIds: number[], name = 'Max Muster'): Promise<{ status: number; json: any; token?: string }> {
    const challenge = await api('POST', '/api/auth/challenge');
    const fields = { personId, groupIds, nonce: challenge.data.nonce, issuedAt: new Date().toISOString() };
    const assertion = { ...fields, personName: name, signature: hmacSha256(SECRET, bridgeAssertionMessage(fields)) };
    const res = await api('POST', '/api/auth/session', { assertion });
    return { status: res.status, json: res.json, token: res.data?.token };
}

function reportData(datum: string, photos = 1): ReportData {
    return {
        projektnummer: '2401234',
        berichtNr: '3',
        bauvorhaben: 'Musterhalle (fiktiv)',
        leitenderMonteur: 'Max Muster',
        datum,
        beginn: '07:00',
        ende: '16:15',
        wetter: { regen: true, frost: false, schnee: false, sonne: false, wind: false },
        temperatur: '8 °C',
        wetterSonstiges: '',
        baustellenort: '46395',
        mitarbeiter: ['Max Muster', 'Erika Beispiel'],
        arbeiten: [{ beschreibung: 'Fenster eingebaut', bauteil: 'Raum 2.14', geschoss: '2. OG', ansicht: 'Nord' }],
        zusatzAufAnweisung: false,
        zusatz: [],
        vorkommnisse: '',
        unterschriftAuftraggeber: { name: '', image: null },
        unterschriftLansing: { name: '', image: null },
        auftraggeberEmail: '',
        fotos: Array.from({ length: photos }, (_, i) => ({ file: `foto-0${i + 1}.jpg`, caption: 'Test' })),
    };
}

const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(1_200_000, 7)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(300_000, 1)]);

async function upload(token: string, id: string, name: string, data: Buffer, from = 0, chunk = 512 * 1024): Promise<number> {
    let received = from;
    while (received < data.length) {
        const res = await fetch(`${base}/api/reports/${id}/files/${name}?offset=${received}`, {
            method: 'PUT',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream' },
            body: new Uint8Array(data.subarray(received, Math.min(received + chunk, data.length))),
        });
        received = (await res.json()).data.received;
    }
    return received;
}

describe('Anmeldung', () => {
    it('lehnt Personen ohne Team-/Admin-Gruppe ab', async () => {
        const res = await login('AAA-11111', [5, 6]);
        assert.equal(res.status, 403);
        assert.equal(res.json.error.code, 'FORBIDDEN');
    });

    it('lehnt gefälschte Signaturen ab', async () => {
        const challenge = await api('POST', '/api/auth/challenge');
        const fields = { personId: 'AAA-11111', groupIds: [TEAM], nonce: challenge.data.nonce, issuedAt: new Date().toISOString() };
        const res = await api('POST', '/api/auth/session', { assertion: { ...fields, signature: hmacSha256('falsch', bridgeAssertionMessage(fields)) } });
        assert.equal(res.json.error.code, 'BRIDGE_REJECTED');
    });

    it('nutzt eine Nonce nur einmal', async () => {
        const challenge = await api('POST', '/api/auth/challenge');
        const fields = { personId: 'AAA-11111', groupIds: [TEAM], nonce: challenge.data.nonce, issuedAt: new Date().toISOString() };
        const assertion = { ...fields, signature: hmacSha256(SECRET, bridgeAssertionMessage(fields)) };
        assert.equal((await api('POST', '/api/auth/session', { assertion })).status, 200);
        assert.equal((await api('POST', '/api/auth/session', { assertion })).json.error.code, 'BRIDGE_REJECTED');
    });

    it('vergibt Rollen nach Gruppen', async () => {
        assert.equal((await login('AAA-11111', [TEAM])).json.data.role, 'employee');
        assert.equal((await login('BBB-22222', [ADMIN])).json.data.role, 'admin');
        assert.equal((await login('FFF-66666', [223675])).json.data.role, 'admin');
        assert.equal((await login('GGG-77777', [TEAM, 223675])).json.data.role, 'admin');
    });

    it('Bridge-Signatur (reines JS) passt zur Server-Prüfung', () => {
        const fields = { personId: 'X', groupIds: [3, 1, 2], nonce: 'n', issuedAt: '2026-11-11T00:00:00.000Z' };
        assert.equal(hmacHex(SECRET, bridgeAssertionMessage(fields)), hmacSha256(SECRET, bridgeAssertionMessage(fields)));
    });
});

describe('Berichte', () => {
    let employee = '';
    let other = '';
    let admin = '';
    let reportId = '';

    before(async () => {
        employee = (await login('AAA-11111', [TEAM], 'Max Muster')).token!;
        other = (await login('CCC-33333', [TEAM], 'Erika Beispiel')).token!;
        admin = (await login('BBB-22222', [ADMIN], 'Chefin')).token!;
    });

    it('lädt in Stücken hoch, setzt nach Abbruch fort und schließt ab', async () => {
        const request = {
            clientId: 'client-0001-abcdef',
            data: reportData('2026-11-10'),
            files: [
                { name: 'bericht.pdf', kind: 'pdf', contentType: 'application/pdf', size: PDF.length },
                { name: 'foto-01.jpg', kind: 'photo', contentType: 'image/jpeg', size: JPEG.length },
            ],
        };
        const created = await api('POST', '/api/reports', request, employee);
        assert.equal(created.status, 200, JSON.stringify(created.json));
        reportId = created.data.id;
        assert.equal(created.data.status, 'uploading');

        // Erstes Stück, dann "Abbruch": erneutes Anlegen liefert den Stand.
        await fetch(`${base}/api/reports/${reportId}/files/bericht.pdf?offset=0`, {
            method: 'PUT',
            headers: { Authorization: `Bearer ${employee}` },
            body: new Uint8Array(PDF.subarray(0, 512 * 1024)),
        });
        const resumed = await api('POST', '/api/reports', request, employee);
        assert.equal(resumed.data.id, reportId);
        const pdfState = resumed.data.files.find((f: any) => f.name === 'bericht.pdf');
        assert.equal(pdfState.received, 512 * 1024);

        // Unvollständig abschließen schlägt fehl.
        assert.equal((await api('POST', `/api/reports/${reportId}/complete`, undefined, employee)).json.error.code, 'CONFLICT');

        // Wiederholtes (doppeltes) Stück wird ignoriert.
        const dup = await fetch(`${base}/api/reports/${reportId}/files/bericht.pdf?offset=0`, {
            method: 'PUT',
            headers: { Authorization: `Bearer ${employee}` },
            body: new Uint8Array(PDF.subarray(0, 512 * 1024)),
        });
        assert.equal((await dup.json()).data.received, 512 * 1024);

        assert.equal(await upload(employee, reportId, 'bericht.pdf', PDF, pdfState.received), PDF.length);
        assert.equal(await upload(employee, reportId, 'foto-01.jpg', JPEG), JPEG.length);
        const done = await api('POST', `/api/reports/${reportId}/complete`, undefined, employee);
        assert.equal(done.status, 200, JSON.stringify(done.json));
        assert.equal(done.data.status, 'complete');
        assert.equal(done.data.createdBy.name, 'Max Muster');

        const pdf = await fetch(`${base}/api/reports/${reportId}/files/bericht.pdf`, { headers: { Authorization: `Bearer ${employee}` } });
        assert.equal(pdf.headers.get('content-type'), 'application/pdf');
        assert.equal(Buffer.from(await pdf.arrayBuffer()).equals(PDF), true);
    });

    it('weist beschädigte Dateien ab', async () => {
        const fake = Buffer.alloc(1000, 1);
        const created = await api(
            'POST',
            '/api/reports',
            { clientId: 'client-0002-abcdef', data: reportData('2026-11-09', 0), files: [{ name: 'bericht.pdf', kind: 'pdf', size: fake.length }] },
            employee,
        );
        await upload(employee, created.data.id, 'bericht.pdf', fake);
        const done = await api('POST', `/api/reports/${created.data.id}/complete`, undefined, employee);
        assert.equal(done.json.error.code, 'VALIDATION_ERROR');
    });

    it('prüft Pflichtfelder', async () => {
        const data = { ...reportData('2026-11-10', 0), projektnummer: '123' };
        const res = await api('POST', '/api/reports', { clientId: 'client-0003-abcdef', data, files: [{ name: 'bericht.pdf', kind: 'pdf', size: 10 }] }, employee);
        assert.equal(res.json.error.code, 'VALIDATION_ERROR');
        assert.deepEqual(res.json.error.fields, ['projektnummer']);
    });

    it('zeigt Berichte nur dem Ersteller und Admins', async () => {
        assert.equal((await api('GET', `/api/reports/${reportId}`, undefined, other)).status, 404);
        assert.equal((await api('GET', `/api/reports/${reportId}`, undefined, admin)).status, 200);
        assert.equal((await api('GET', '/api/reports/mine', undefined, employee)).data.length, 1);
        assert.equal((await api('GET', '/api/reports/mine', undefined, other)).data.length, 0);
    });

    it('Admin-Liste filtert nach Berichtsdatum und ist nur für Admins', async () => {
        assert.equal((await api('GET', '/api/admin/reports?from=2026-11-09&to=2026-11-15', undefined, employee)).status, 403);
        const week = await api('GET', '/api/admin/reports?from=2026-11-09&to=2026-11-15', undefined, admin);
        assert.equal(week.data.reports.length, 1);
        assert.equal(week.data.reports[0].isoWeek, '2026-W46');
        const before = await api('GET', '/api/admin/reports?from=2026-11-01&to=2026-11-08', undefined, admin);
        assert.equal(before.data.reports.length, 0);
        assert.equal((await api('GET', '/api/admin/reports?from=2026-11-15&to=2026-11-09', undefined, admin)).status, 400);
    });

    it('Mitarbeiterliste: lesen für alle, schreiben nur Admin', async () => {
        assert.equal((await api('PUT', '/api/admin/settings', { employees: ['A'] }, employee)).status, 403);
        const saved = await api('PUT', '/api/admin/settings', { employees: ['Zora Test', 'Anton Test', 'Anton Test', ''] }, admin);
        assert.deepEqual(saved.data.employees, ['Anton Test', 'Zora Test']);
        assert.deepEqual((await api('GET', '/api/settings', undefined, employee)).data.employees, ['Anton Test', 'Zora Test']);
    });

    it('Admin kann löschen', async () => {
        assert.equal((await api('DELETE', `/api/admin/reports/${reportId}`, undefined, admin)).status, 200);
        assert.equal((await api('GET', `/api/reports/${reportId}`, undefined, admin)).status, 404);
    });

    it('ohne Sitzung kein Zugriff', async () => {
        assert.equal((await api('GET', '/api/reports/mine')).status, 401);
    });
});

describe('E-Mail an den Auftraggeber', () => {
    let employee = '';
    let admin = '';
    let counter = 0;

    before(async () => {
        employee = (await login('DDD-44444', [TEAM], 'Max Muster')).token!;
        admin = (await login('EEE-55555', [ADMIN], 'Chefin')).token!;
    });

    async function saveReport(email: string): Promise<string> {
        counter += 1;
        const data = { ...reportData('2026-11-12', 0), auftraggeberEmail: email, unterschriftAuftraggeber: { name: 'Bernd Bauherr', image: null } };
        const created = await api(
            'POST',
            '/api/reports',
            { clientId: `mail-client-${counter}-abcdef`, data, files: [{ name: 'bericht.pdf', kind: 'pdf', size: PDF.length }] },
            employee,
        );
        assert.equal(created.status, 200, JSON.stringify(created.json));
        await upload(employee, created.data.id, 'bericht.pdf', PDF);
        const done = await api('POST', `/api/reports/${created.data.id}/complete`, undefined, employee);
        assert.equal(done.status, 200, JSON.stringify(done.json));
        await Promise.all([...app.context.background]);
        return created.data.id;
    }

    it('verschickt das PDF nach dem Speichern', async () => {
        sentMails.length = 0;
        mailFailure = null;
        const id = await saveReport('bauherr@example.invalid');
        assert.equal(sentMails.length, 1);
        const mail = sentMails[0]!;
        assert.equal(mail.to, 'bauherr@example.invalid');
        assert.equal(mail.replyTo, 'buero@example.invalid');
        assert.match(mail.subject, /Bautagesbericht 2401234 Nr\. 3 vom 12\.11\.2026/);
        assert.match(mail.text, /Guten Tag Bernd Bauherr/);
        assert.equal(mail.attachments[0]!.filename, '2026-11-12_2401234_03.pdf');
        const detail = await api('GET', `/api/reports/${id}`, undefined, admin);
        assert.equal(detail.data.mail.status, 'sent');
    });

    it('nachträglich ergänzte Adresse: erneutes Speichern ersetzt den Bericht und verschickt', async () => {
        sentMails.length = 0;
        mailFailure = null;
        const files = [{ name: 'bericht.pdf', kind: 'pdf', size: PDF.length }];
        const base = { ...reportData('2026-11-12', 0), unterschriftAuftraggeber: { name: 'Bernd Bauherr', image: null } };
        const first = await api('POST', '/api/reports', { clientId: 'mail-later-abcdef', data: base, files }, employee);
        await upload(employee, first.data.id, 'bericht.pdf', PDF);
        await api('POST', `/api/reports/${first.data.id}/complete`, undefined, employee);
        // Gleicher Stand erneut: kein neuer Bericht.
        assert.equal((await api('POST', '/api/reports', { clientId: 'mail-later-abcdef', data: base, files }, employee)).data.id, first.data.id);
        // Mit E-Mail: ersetzt.
        const data = { ...base, auftraggeberEmail: 'spaeter@example.invalid' };
        const second = await api('POST', '/api/reports', { clientId: 'mail-later-abcdef', data, files }, employee);
        assert.notEqual(second.data.id, first.data.id);
        await upload(employee, second.data.id, 'bericht.pdf', PDF);
        const done = await api('POST', `/api/reports/${second.data.id}/complete`, undefined, employee);
        assert.equal(done.data.mail.to, 'spaeter@example.invalid');
        await Promise.all([...app.context.background]);
        assert.equal(sentMails.at(-1)!.to, 'spaeter@example.invalid');
        assert.equal((await api('GET', `/api/reports/${first.data.id}`, undefined, admin)).status, 404);
    });

    it('ohne Adresse keine Mail', async () => {
        sentMails.length = 0;
        const id = await saveReport('');
        assert.equal(sentMails.length, 0);
        assert.equal((await api('GET', `/api/reports/${id}`, undefined, admin)).data.mail.status, 'none');
    });

    it('lehnt ungültige Adressen ab', async () => {
        const data = { ...reportData('2026-11-12', 0), auftraggeberEmail: 'kein-mail' };
        const res = await api('POST', '/api/reports', { clientId: 'mail-invalid-abcdef', data, files: [{ name: 'bericht.pdf', kind: 'pdf', size: 10 }] }, employee);
        assert.deepEqual(res.json.error.fields, ['auftraggeberEmail']);
    });

    it('wiederholt fehlgeschlagene Versuche und gibt nach 3 auf; Admin kann neu senden', async () => {
        sentMails.length = 0;
        mailFailure = Object.assign(new Error('Mailbox unavailable'), { responseCode: 550 });
        const id = await saveReport('falsch@example.invalid');
        let mail = (await api('GET', `/api/reports/${id}`, undefined, admin)).data.mail;
        assert.equal(mail.status, 'pending');
        assert.equal(mail.attempts, 1);
        assert.match(mail.error, /550/);
        for (let i = 0; i < 3; i += 1) {
            app.context.store.setMail(id, { lastTry: '2000-01-01T00:00:00.000Z' });
            await app.retryMails();
        }
        mail = (await api('GET', `/api/reports/${id}`, undefined, admin)).data.mail;
        assert.equal(mail.status, 'failed');
        assert.equal(mail.attempts, 3);

        mailFailure = null;
        assert.equal((await api('POST', `/api/admin/reports/${id}/mail`, { to: 'richtig@example.invalid' }, employee)).status, 403);
        const resent = await api('POST', `/api/admin/reports/${id}/mail`, { to: 'richtig@example.invalid' }, admin);
        assert.equal(resent.data.mail.status, 'sent');
        assert.equal(resent.data.mail.to, 'richtig@example.invalid');
        assert.equal(sentMails.at(-1)!.to, 'richtig@example.invalid');
    });
});

describe('Bridge', () => {
    it('verweigert KI ohne passende Gruppe und strukturiert sonst', async () => {
        let groups = [5];
        (globalThis as any).chayns = {
            person: {
                current: { getId: async () => 'AAA-11111', getUacGroups: async () => groups.map((id) => ({ id, name: '' })) },
                getPublicInformation: async () => ({ firstName: 'Max', lastName: 'Muster' }),
            },
            sites: { current: { getId: async () => '99820-05034' } },
            ai: { prompt: async () => '```json\n{"rows":[{"beschreibung":"Fenster eingebaut","bauteil":"","geschoss":"2. OG","ansicht":"Nord"}]}\n```' },
        };
        const bridge = createBridge({ secret: SECRET, allowedGroupIds: [TEAM, ADMIN] });
        const denied = await bridge({ body: { action: 'ai', payload: { mode: 'work', text: 'Fenster' } } });
        assert.equal((denied.body as any).error.code, 'FORBIDDEN');
        groups = [TEAM];
        const ok = await bridge({ body: { action: 'ai', payload: { mode: 'work', text: 'Fenster im 2. OG Nord' } } });
        assert.deepEqual((ok.body as any).data.rows[0], { beschreibung: 'Fenster eingebaut', bauteil: '', geschoss: '2. OG', ansicht: 'Nord' });
        const asserted = await bridge({ action: 'assert', payload: { nonce: 'abc' } });
        assert.equal((asserted.body as any).data.personName, 'Max Muster');
    });

    it('liest KI-Antworten defensiv', () => {
        assert.equal(parseAiAnswer('photo', '{"text":"Fassade Nord nach Montage"}').text, 'Fassade Nord nach Montage');
        assert.equal(parseAiAnswer('events', '{"rows":[{"beschreibung":""},{"beschreibung":"Kran fiel aus"}]}').rows.length, 1);
        assert.throws(() => parseAiAnswer('work', 'kein json'));
    });
});
