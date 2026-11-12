/**
 * Admin-Bereich: gespeicherte Berichte im gewählten Zeitraum (Standard: aktuelle KW) mit
 * chayns-Ersteller, Suche, PDF/Fotos, Löschen; Pflege der Mitarbeiterliste für das Formular.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Language } from 'chayns-api';
import { Accordion, AccordionContent, Button, Input, List, SmallWaitCursor, TextArea } from '@chayns-components/core';
import { Calendar, CalendarType, type DateInterval } from '@chayns-components/date';
import { formatDayKey, isoWeekOf, toDayKey, weekRangeOf, type ReportListResponse, type ReportSummary, type SettingsResponse } from '../../../shared/contract';
import { authRequest, getErrorMessage } from '../common/api';
import { toast } from '../common/dialogs';
import { Notice } from '../common/Notice';
import type { ShellContext } from '../common/Shell';
import { ReportItem } from './ReportItem';

function currentWeek(): DateInterval {
    return weekRangeOf(new Date());
}

function rangeLabel(range: DateInterval): string {
    const from = toDayKey(range.start);
    const to = toDayKey(range.end ?? range.start);
    const weekFrom = isoWeekOf(from);
    const sameWeek = weekFrom === isoWeekOf(to) && toDayKey(weekRangeOf(range.start).start) === from && toDayKey(weekRangeOf(range.start).end) === to;
    const weekText = sameWeek ? `KW ${Number(weekFrom.slice(-2))} · ` : '';
    return from === to ? formatDayKey(from) : `${weekText}${formatDayKey(from)} – ${formatDayKey(to)}`;
}

function shiftWeek(range: DateInterval, weeks: number): DateInterval {
    const start = new Date(range.start);
    start.setDate(start.getDate() + weeks * 7);
    return weekRangeOf(start);
}

function EmployeesEditor() {
    const [text, setText] = useState<string | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        authRequest<SettingsResponse>('GET', '/api/settings')
            .then((settings) => setText(settings.employees.join('\n')))
            .catch((err: unknown) => setError(getErrorMessage(err)));
    }, []);

    const save = async () => {
        setIsSaving(true);
        setError(null);
        try {
            const employees = (text ?? '').split('\n').map((line) => line.trim()).filter(Boolean);
            const saved = await authRequest<SettingsResponse>('PUT', '/api/admin/settings', { employees });
            setText(saved.employees.join('\n'));
            toast('Mitarbeiterliste gespeichert.');
        } catch (err) {
            setError(getErrorMessage(err));
        } finally {
            setIsSaving(false);
        }
    };

    if (text === null && !error) return <SmallWaitCursor />;
    return (
        <div className="stack">
            <p className="hint-text">Ein Name je Zeile. Die Liste steht im Formular bei „Leitender Monteur“ und „Mitarbeiter“ zur Auswahl.</p>
            <TextArea value={text ?? ''} minHeight={160} placeholder="Vorname Nachname" onChange={(event) => setText(event.target.value)} />
            {error && <Notice type="error">{error}</Notice>}
            <div className="button-row">
                <Button icon="fa fa-floppy-disk" shouldShowWaitCursor={isSaving} onClick={() => void save()}>
                    Speichern
                </Button>
            </div>
        </div>
    );
}

export function AdminApp({ context }: { context: ShellContext }) {
    const [range, setRange] = useState<DateInterval>(currentWeek);
    const [reports, setReports] = useState<ReportSummary[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [query, setQuery] = useState('');

    const from = toDayKey(range.start);
    const to = toDayKey(range.end ?? range.start);

    const load = useCallback(async () => {
        setReports(null);
        setError(null);
        try {
            const result = await authRequest<ReportListResponse>('GET', `/api/admin/reports?from=${from}&to=${to}`);
            setReports(result.reports);
        } catch (err) {
            setError(getErrorMessage(err));
        }
    }, [from, to]);

    useEffect(() => {
        void load();
    }, [load]);

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!reports || !q) return reports;
        return reports.filter((r) =>
            [r.projektnummer, r.berichtNr, r.bauvorhaben, r.leitenderMonteur, r.createdBy.name ?? ''].some((value) => value.toLowerCase().includes(q)),
        );
    }, [reports, query]);

    const onCalendarChange = (value: Date | Date[] | DateInterval) => {
        // Erst laden, wenn Anfang und Ende gewählt sind (der erste Klick liefert nur den Anfang).
        if (value && !Array.isArray(value) && !(value instanceof Date) && value.start && value.end) {
            setRange({ start: value.start, end: value.end });
        }
    };

    return (
        <div className="page">
            <div className="page-head">
                <h1>Bautagesberichte</h1>
                <span className="hint-text">Administration · {context.identity.personName ?? ''}</span>
            </div>

            <div className="sections">
                <Accordion title="Zeitraum" icon="fa fa-calendar-week" isDefaultOpen rightElement={<span className="accordion-note">{rangeLabel(range)}</span>}>
                    <AccordionContent>
                        <div className="stack">
                            <Calendar
                                type={CalendarType.Interval}
                                locale={Language.German}
                                selectedDateInterval={range}
                                onChange={onCalendarChange}
                                showMonthYearPickers
                            />
                            <div className="button-row">
                                <Button isSecondary icon="fa fa-chevron-left" onClick={() => setRange((r) => shiftWeek(r, -1))}>
                                    Vorwoche
                                </Button>
                                <Button isSecondary onClick={() => setRange(currentWeek())}>
                                    Aktuelle KW
                                </Button>
                                <Button isSecondary icon="fa fa-chevron-right" onClick={() => setRange((r) => shiftWeek(r, 1))}>
                                    Folgewoche
                                </Button>
                            </div>
                        </div>
                    </AccordionContent>
                </Accordion>

                <Accordion
                    title={`Berichte ${rangeLabel(range)}`}
                    icon="fa fa-file-lines"
                    isDefaultOpen
                    rightElement={reports ? <span className="accordion-note">{filtered?.length ?? 0}</span> : undefined}
                >
                    <AccordionContent>
                        <div className="stack">
                            <Input
                                placeholder="Suche: Projekt, Bauvorhaben, Monteur, Ersteller"
                                value={query}
                                shouldShowClearIcon
                                onChange={(event) => setQuery(event.target.value)}
                            />
                            {error && <Notice type="error">{error}</Notice>}
                            {!reports && !error && <SmallWaitCursor />}
                            {filtered && filtered.length === 0 && <p className="hint-text">Keine Berichte in diesem Zeitraum.</p>}
                        </div>
                    </AccordionContent>
                    {filtered && filtered.length > 0 && (
                        <List>
                            {filtered.map((report) => (
                                <ReportItem key={report.id} report={report} onDeleted={(id) => setReports((list) => list?.filter((r) => r.id !== id) ?? null)} />
                            ))}
                        </List>
                    )}
                </Accordion>

                <Accordion title="Mitarbeiterliste" icon="fa fa-users">
                    <AccordionContent>
                        <EmployeesEditor />
                    </AccordionContent>
                </Accordion>
            </div>
        </div>
    );
}
