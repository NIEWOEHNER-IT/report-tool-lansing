/**
 * Eigene, bereits gespeicherte Berichte (letzte 30) mit PDF-Abruf.
 */
import { useCallback, useEffect, useState } from 'react';
import { Button, List, ListItem, SmallWaitCursor } from '@chayns-components/core';
import { formatDayKey, pdfFileName, type ReportSummary } from '../../../shared/contract';
import { authRequest, fetchBlob, getErrorMessage } from '../common/api';
import { shareOrDownload } from '../common/files';
import { Notice } from '../common/Notice';

export function MyReports({ refreshKey }: { refreshKey: number }) {
    const [reports, setReports] = useState<ReportSummary[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busyId, setBusyId] = useState<string | null>(null);

    const load = useCallback(async () => {
        setError(null);
        try {
            setReports(await authRequest<ReportSummary[]>('GET', '/api/reports/mine'));
        } catch (err) {
            setError(getErrorMessage(err));
        }
    }, []);

    useEffect(() => {
        void load();
    }, [load, refreshKey]);

    const openPdf = async (report: ReportSummary) => {
        setBusyId(report.id);
        try {
            const blob = await fetchBlob(`/api/reports/${report.id}/files/bericht.pdf`);
            await shareOrDownload(blob, pdfFileName({ datum: report.datum, projektnummer: report.projektnummer, berichtNr: report.berichtNr }));
        } catch (err) {
            setError(getErrorMessage(err));
        } finally {
            setBusyId(null);
        }
    };

    if (error) return <Notice type="error">{error}</Notice>;
    if (!reports) return <SmallWaitCursor />;
    if (reports.length === 0) return <p className="hint-text">Noch keine Berichte gespeichert.</p>;
    return (
        <List>
            {reports.map((report) => (
                <ListItem
                    key={report.id}
                    icons={['fa fa-file-pdf']}
                    title={`${report.projektnummer} · Nr. ${report.berichtNr}`}
                    subtitle={`${formatDayKey(report.datum)} · ${report.bauvorhaben || 'ohne Bauvorhaben'}`}
                    rightElements={
                        <Button isSecondary shouldShowWaitCursor={busyId === report.id} onClick={() => void openPdf(report)}>
                            PDF
                        </Button>
                    }
                />
            ))}
        </List>
    );
}
