/**
 * Diktat mit KI: Text über das Mikrofon der Tastatur einsprechen (iPad: Mikrofon-Taste),
 * dann von der KI in Zeilen gliedern lassen, prüfen und übernehmen.
 */
import { useState } from 'react';
import { Button, TextArea } from '@chayns-components/core';
import type { AiMode, AiResult } from '../../../../shared/contract';
import { getErrorMessage } from '../../common/api';
import { Notice } from '../../common/Notice';
import { structureText } from '../ai';

export interface DictationPanelProps {
    mode: AiMode;
    bridgeUrl: string | null;
    title: string;
    /** Platz im Formular (für den Hinweis). */
    freeRows?: number;
    onApply: (result: AiResult) => void;
    onClose: () => void;
}

const COLUMNS: Record<AiMode, string> = {
    work: 'Tätigkeit · Bauteil · Geschoss · Ansicht',
    extra: 'Tätigkeit · Mitarbeiter · Std./Person',
    events: 'Vorkommnis',
    photo: 'Bildbeschreibung',
};

export function DictationPanel({ mode, bridgeUrl, title, freeRows, onApply, onClose }: DictationPanelProps) {
    const [text, setText] = useState('');
    const [result, setResult] = useState<AiResult | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [isBusy, setIsBusy] = useState(false);

    const run = async () => {
        if (!text.trim()) return;
        setIsBusy(true);
        setError(null);
        try {
            setResult(await structureText(bridgeUrl, mode, text));
        } catch (err) {
            setError(getErrorMessage(err));
        } finally {
            setIsBusy(false);
        }
    };

    const rowText = (row: AiResult['rows'][number]) =>
        mode === 'work'
            ? [row.beschreibung, row.bauteil, row.geschoss, row.ansicht].filter(Boolean).join(' · ')
            : mode === 'extra'
              ? [row.beschreibung, row.mitarbeiter && `${row.mitarbeiter} MA`, row.stunden && `${row.stunden} Std.`].filter(Boolean).join(' · ')
              : row.beschreibung;

    return (
        <div className="dictation">
            <div className="dictation__head">
                <strong>{title}</strong>
                <span className="hint-text">Ins Textfeld tippen und auf der Tastatur das Mikrofon wählen.</span>
            </div>
            <TextArea
                placeholder="Text eingeben oder diktieren"
                value={text}
                minHeight={110}
                onChange={(event) => {
                    setText(event.target.value);
                    setResult(null);
                }}
            />
            {error && <Notice type="error">{error}</Notice>}
            {result && (
                <div className="dictation__result">
                    <span className="hint-text">Vorschlag ({COLUMNS[mode]}) – bitte prüfen:</span>
                    {mode === 'photo' ? (
                        <p className="dictation__text">{result.text}</p>
                    ) : result.rows.length === 0 ? (
                        <p className="hint-text">Die KI hat keine Einträge erkannt.</p>
                    ) : (
                        <ol className="dictation__rows">
                            {result.rows.map((row, i) => (
                                <li key={i}>{rowText(row)}</li>
                            ))}
                        </ol>
                    )}
                    {freeRows !== undefined && mode !== 'photo' && result.rows.length > freeRows && (
                        <Notice type="warning">Es sind nur noch {freeRows} Zeilen frei. Überzählige Einträge bitte kürzen oder zusammenfassen.</Notice>
                    )}
                </div>
            )}
            <div className="button-row">
                <Button isSecondary onClick={onClose}>
                    Schließen
                </Button>
                <span className="spacer" />
                <Button isSecondary icon="fa fa-wand-magic-sparkles" isDisabled={!text.trim()} shouldShowWaitCursor={isBusy} onClick={() => void run()}>
                    Mit KI überarbeiten
                </Button>
                <Button
                    icon="fa fa-check"
                    isDisabled={!result && !text.trim()}
                    onClick={() => {
                        onApply(result ?? (mode === 'photo' ? { rows: [], text: text.trim() } : { rows: [{ beschreibung: text.trim() }] }));
                        onClose();
                    }}
                >
                    Übernehmen
                </Button>
            </div>
        </div>
    );
}
