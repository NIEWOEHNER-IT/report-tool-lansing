/**
 * Prüfen und Absenden. Nach dem Speichern: PDF teilen/speichern oder Folgebericht beginnen.
 */
import { useState } from 'react';
import { Button, ProgressBar } from '@chayns-components/core';
import { formatDayKey } from '../../../shared/contract';
import { getErrorMessage } from '../common/api';
import { confirmDialog } from '../common/dialogs';
import { openBlob, shareOrDownload } from '../common/files';
import { Notice } from '../common/Notice';
import type { Draft } from './draft';
import { checkDraft, submitDraft, type SubmitProgress, type SubmitResult } from './submit';

export interface SubmitSectionProps {
    draft: Draft;
    onSubmitted: (result: SubmitResult) => void;
    onNext: () => void;
    onClear: () => void;
    result: SubmitResult | null;
}

export function SubmitSection({ draft, onSubmitted, onNext, onClear, result }: SubmitSectionProps) {
    const [progress, setProgress] = useState<SubmitProgress | null>(null);
    const [error, setError] = useState<string | null>(null);
    const problems = checkDraft(draft);

    const submit = async () => {
        if (!draft.unterschriftLansing.image || !draft.unterschriftAuftraggeber.image) {
            const ok = await confirmDialog('Es fehlt mindestens eine Unterschrift. Bericht trotzdem speichern?', 'Speichern');
            if (!ok) return;
        }
        setError(null);
        setProgress({ step: 'pdf', fraction: 0, text: 'Wird vorbereitet …' });
        try {
            onSubmitted(await submitDraft(draft, setProgress));
        } catch (err) {
            setError(`${getErrorMessage(err)} Der Entwurf bleibt erhalten; erneutes Speichern setzt den Upload fort.`);
        } finally {
            setProgress(null);
        }
    };

    if (result) {
        return (
            <div className="stack">
                <Notice type="success">
                    Bericht {result.report.projektnummer} / Nr. {result.report.berichtNr} vom {formatDayKey(result.report.datum)} ist gespeichert.
                    {result.report.mail.to && ` Die Kopie an ${result.report.mail.to} wird per E-Mail verschickt.`}
                </Notice>
                <div className="button-row">
                    <Button icon="fa fa-share-from-square" onClick={() => void shareOrDownload(result.pdf, result.fileName)}>
                        PDF teilen / speichern
                    </Button>
                    <Button isSecondary icon="fa fa-file-pdf" onClick={() => openBlob(result.pdf)}>
                        PDF ansehen
                    </Button>
                </div>
                <div className="button-row">
                    <Button icon="fa fa-forward" onClick={onNext}>
                        Nächster Bericht (gleiches Projekt)
                    </Button>
                    <Button isSecondary icon="fa fa-file" onClick={onClear}>
                        Leerer Bericht
                    </Button>
                </div>
            </div>
        );
    }

    return (
        <div className="stack">
            {problems.length > 0 ? (
                <Notice type="warning">
                    <span>Vor dem Speichern noch ergänzen:</span>
                    <ul className="plain-list">
                        {problems.map((problem, i) => (
                            <li key={i}>{problem.text}</li>
                        ))}
                    </ul>
                </Notice>
            ) : (
                <p className="hint-text">Beim Speichern wird das PDF erstellt und mit den Fotos sicher auf dem Lansing-Server abgelegt.</p>
            )}
            {error && <Notice type="error">{error}</Notice>}
            {progress && <ProgressBar percentage={Math.round(progress.fraction * 100) as 0} label={progress.text} />}
            <div className="button-row">
                <Button icon="fa fa-cloud-arrow-up" isDisabled={problems.length > 0 || !!progress} shouldShowWaitCursor={!!progress} onClick={() => void submit()}>
                    Bericht speichern
                </Button>
                <Button isSecondary icon="fa fa-trash" isDisabled={!!progress} onClick={onClear}>
                    Formular leeren
                </Button>
            </div>
        </div>
    );
}
