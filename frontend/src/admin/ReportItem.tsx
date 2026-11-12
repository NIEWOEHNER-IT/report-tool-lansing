/**
 * Ein Bericht in der Admin-Liste: Kopf mit Projekt/Datum/Ersteller, aufgeklappt Details,
 * PDF, Fotos und Löschen. Details und Fotos werden erst beim Aufklappen geladen.
 */
import { useEffect, useState } from 'react';
import { Button, ListItem, ListItemContent, SmallWaitCursor } from '@chayns-components/core';
import { formatDayKey, pdfFileName, weekdayOf, type MailInfo, type ReportDetail, type ReportSummary } from '../../../shared/contract';
import { authRequest, fetchBlob, getErrorMessage } from '../common/api';
import { confirmDialog, inputDialog, toast } from '../common/dialogs';
import { downloadBlob, humanSize, openBlob } from '../common/files';
import { Notice } from '../common/Notice';

function PhotoThumb({ reportId, name, caption }: { reportId: string; name: string; caption: string }) {
    const [url, setUrl] = useState<string | null>(null);
    const [blob, setBlob] = useState<Blob | null>(null);
    useEffect(() => {
        let objectUrl: string | null = null;
        let cancelled = false;
        fetchBlob(`/api/reports/${reportId}/files/${name}`)
            .then((b) => {
                if (cancelled) return;
                objectUrl = URL.createObjectURL(b);
                setBlob(b);
                setUrl(objectUrl);
            })
            .catch(() => undefined);
        return () => {
            cancelled = true;
            if (objectUrl) URL.revokeObjectURL(objectUrl);
        };
    }, [reportId, name]);
    return (
        <figure className="admin-photo">
            {url ? (
                <img src={url} alt={caption} onClick={() => blob && openBlob(blob)} />
            ) : (
                <div className="admin-photo__placeholder">
                    <SmallWaitCursor />
                </div>
            )}
            {caption && <figcaption>{caption}</figcaption>}
        </figure>
    );
}

function Details({ detail }: { detail: ReportDetail }) {
    const d = detail.data;
    const weather = Object.entries(d.wetter)
        .filter(([, on]) => on)
        .map(([key]) => key.charAt(0).toUpperCase() + key.slice(1));
    const rows: [string, string][] = [
        ['Bauvorhaben', d.bauvorhaben],
        ['Leitender Monteur', d.leitenderMonteur],
        ['Datum', `${weekdayOf(d.datum)}, ${formatDayKey(d.datum)}`],
        ['Zeit', [d.beginn, d.ende].filter(Boolean).join(' – ')],
        ['Wetter', [weather.join(', '), d.temperatur, d.wetterSonstiges].filter(Boolean).join(' · ')],
        ['Mitarbeiter', d.mitarbeiter.join(', ')],
    ];
    return (
        <div className="stack">
            <dl className="detail-grid">
                {rows
                    .filter(([, value]) => value)
                    .map(([label, value]) => (
                        <div className="detail-grid__row" key={label}>
                            <dt>{label}</dt>
                            <dd>{value}</dd>
                        </div>
                    ))}
            </dl>
            {d.arbeiten.length > 0 && (
                <div>
                    <strong>Ausgeführte Arbeiten</strong>
                    <ul className="plain-list">
                        {d.arbeiten.map((row, i) => (
                            <li key={i}>{[row.beschreibung, row.bauteil, row.geschoss, row.ansicht].filter(Boolean).join(' · ')}</li>
                        ))}
                    </ul>
                </div>
            )}
            {d.zusatz.length > 0 && (
                <div>
                    <strong>Zusätzliche Arbeiten{d.zusatzAufAnweisung ? ' (auf Anweisung der Bauleitung)' : ''}</strong>
                    <ul className="plain-list">
                        {d.zusatz.map((row, i) => (
                            <li key={i}>
                                {[row.beschreibung, row.mitarbeiter && `${row.mitarbeiter} MA`, row.stunden && `${row.stunden} Std./Person`].filter(Boolean).join(' · ')}
                            </li>
                        ))}
                    </ul>
                </div>
            )}
            {d.vorkommnisse && (
                <div>
                    <strong>Besondere Vorkommnisse</strong>
                    <p className="pre-line">{d.vorkommnisse}</p>
                </div>
            )}
            {d.fotos.length > 0 && (
                <div className="admin-photos">
                    {d.fotos.map((photo) => (
                        <PhotoThumb key={photo.file} reportId={detail.id} name={photo.file} caption={photo.caption} />
                    ))}
                </div>
            )}
        </div>
    );
}

const MAIL_TEXT: Record<MailInfo['status'], string> = {
    none: '',
    pending: 'E-Mail an den Auftraggeber wird verschickt',
    sent: 'E-Mail an den Auftraggeber verschickt',
    failed: 'E-Mail an den Auftraggeber fehlgeschlagen',
};

function MailLine({ mail, isBusy, onResend }: { mail: MailInfo; isBusy: boolean; onResend: () => void }) {
    if (mail.status === 'none') return null;
    const when = mail.sentAt ? ` am ${new Date(mail.sentAt).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}` : '';
    const type = mail.status === 'sent' ? 'success' : mail.status === 'failed' ? 'error' : 'info';
    return (
        <Notice type={type}>
            <span>
                {MAIL_TEXT[mail.status]} ({mail.to}){when}.{mail.error && mail.status !== 'sent' ? ` Grund: ${mail.error}` : ''}
            </span>
            {mail.status !== 'pending' || mail.attempts > 0 ? (
                <div className="button-row">
                    <Button isSecondary icon="fa fa-paper-plane" shouldShowWaitCursor={isBusy} onClick={onResend}>
                        Erneut senden
                    </Button>
                </div>
            ) : null}
        </Notice>
    );
}

export function ReportItem({ report: initial, onDeleted }: { report: ReportSummary; onDeleted: (id: string) => void }) {
    const [report, setReport] = useState(initial);
    const [detail, setDetail] = useState<ReportDetail | null>(null);
    const [isOpen, setIsOpen] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState<'pdf' | 'delete' | 'mail' | null>(null);

    const resend = async () => {
        const to = await inputDialog('E-Mail-Adresse des Auftraggebers (bei Bedarf korrigieren):', report.mail.to, 'Senden');
        if (to === null) return;
        setBusy('mail');
        setError(null);
        try {
            const updated = await authRequest<ReportSummary>('POST', `/api/admin/reports/${report.id}/mail`, { to: to.trim() });
            setReport(updated);
            toast(updated.mail.status === 'sent' ? 'E-Mail verschickt.' : 'E-Mail konnte nicht verschickt werden.', updated.mail.status === 'sent' ? 'success' : 'error');
        } catch (err) {
            setError(getErrorMessage(err));
        } finally {
            setBusy(null);
        }
    };

    useEffect(() => {
        if (!isOpen || detail) return;
        authRequest<ReportDetail>('GET', `/api/reports/${report.id}`)
            .then(setDetail)
            .catch((err: unknown) => setError(getErrorMessage(err)));
    }, [isOpen, detail, report.id]);

    const pdf = async (mode: 'open' | 'download') => {
        setBusy('pdf');
        try {
            const blob = await fetchBlob(`/api/reports/${report.id}/files/bericht.pdf`);
            if (mode === 'open') openBlob(blob);
            else downloadBlob(blob, pdfFileName({ datum: report.datum, projektnummer: report.projektnummer, berichtNr: report.berichtNr }));
        } catch (err) {
            setError(getErrorMessage(err));
        } finally {
            setBusy(null);
        }
    };

    const remove = async () => {
        const ok = await confirmDialog(
            `Bericht ${report.projektnummer} / Nr. ${report.berichtNr} vom ${formatDayKey(report.datum)} endgültig löschen? PDF und Fotos werden ebenfalls gelöscht.`,
            'Löschen',
        );
        if (!ok) return;
        setBusy('delete');
        try {
            await authRequest('DELETE', `/api/admin/reports/${report.id}`);
            toast('Bericht gelöscht.');
            onDeleted(report.id);
        } catch (err) {
            setError(getErrorMessage(err));
            setBusy(null);
        }
    };

    const createdAt = new Date(report.createdAt).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' });
    return (
        <ListItem
            icons={['fa fa-file-lines']}
            title={`${report.projektnummer} · Nr. ${report.berichtNr} · ${report.bauvorhaben || 'ohne Bauvorhaben'}`}
            subtitle={`${weekdayOf(report.datum).slice(0, 2)}, ${formatDayKey(report.datum)} · erstellt von ${report.createdBy.name ?? report.createdBy.personId}`}
            rightElements={{ top: <span className="hint-text nowrap">{createdAt}</span> }}
            onOpen={() => setIsOpen(true)}
        >
            <ListItemContent>
                <div className="stack">
                    {error && <Notice type="error">{error}</Notice>}
                    <div className="button-row">
                        <Button icon="fa fa-file-pdf" shouldShowWaitCursor={busy === 'pdf'} onClick={() => void pdf('open')}>
                            PDF öffnen
                        </Button>
                        <Button isSecondary icon="fa fa-download" onClick={() => void pdf('download')}>
                            Herunterladen ({humanSize(report.pdfSize)})
                        </Button>
                        <span className="spacer" />
                        <Button isSecondary icon="fa fa-trash" shouldShowWaitCursor={busy === 'delete'} onClick={() => void remove()}>
                            Löschen
                        </Button>
                    </div>
                    <p className="hint-text">
                        chayns-Person: {report.createdBy.name ?? 'unbekannt'} ({report.createdBy.personId}) · {report.photoCount} Fotos
                    </p>
                    <MailLine mail={report.mail} isBusy={busy === 'mail'} onResend={() => void resend()} />
                    {detail ? <Details detail={detail} /> : !error && <SmallWaitCursor />}
                </div>
            </ListItemContent>
        </ListItem>
    );
}
