/**
 * Formularabschnitte: Projekt, Datum/Zeit/Wetter, Mitarbeiter, Arbeiten, Zusätzliche Arbeiten,
 * Vorkommnisse. Inhalte und Regeln wie im A4-Formular der V46.
 */
import { useMemo, useState } from 'react';
import { Badge, BadgeSize, Button, Checkbox, ComboBox, Icon, Input, TextArea, type ComboBoxItem } from '@chayns-components/core';
import { FORM_LIMITS, weekdayOf, type AiResult, type ExtraRow, type WorkRow } from '../../../shared/contract';
import { getErrorMessage } from '../common/api';
import { selectDialog, toast } from '../common/dialogs';
import { Notice } from '../common/Notice';
import { DictationPanel } from './components/DictationPanel';
import { Field, LineUsage } from './components/Field';
import { emptyExtraRow, emptyWorkRow, formatHours, placeForProject, rememberPlace, totalExtraHours, type Draft } from './draft';
import { layoutEvents, layoutExtra, layoutWork } from './pdf/layout';
import { fetchWeather } from './weather';

export type Update = (change: Partial<Draft> | ((draft: Draft) => Draft)) => void;

export interface SectionProps {
    draft: Draft;
    update: Update;
}

const QUARTER_HOURS: ComboBoxItem[] = Array.from({ length: 96 }, (_, i) => {
    const text = `${String(Math.floor(i / 4)).padStart(2, '0')}:${String((i % 4) * 15).padStart(2, '0')}`;
    return { text, value: text };
});

const onlyDigits = (value: string, max: number) => value.replace(/\D/g, '').slice(0, max);

// Projekt ---------------------------------------------------------------------

export function ProjectSection({ draft, update, employees }: SectionProps & { employees: string[] }) {
    const pickMonteur = async () => {
        const result = await selectDialog('Leitenden Monteur auswählen', employees, draft.leitenderMonteur ? [draft.leitenderMonteur] : [], false);
        if (result && result[0]) update({ leitenderMonteur: result[0] });
    };
    return (
        <div className="form-grid">
            <Field label="Projektnummer" hint="7 Ziffern">
                <Input
                    inputMode="numeric"
                    placeholder="z. B. 2401234"
                    value={draft.projektnummer}
                    isInvalid={draft.projektnummer !== '' && draft.projektnummer.length !== 7}
                    onChange={(event) => {
                        const projektnummer = onlyDigits(event.target.value, 7);
                        update((d) => ({
                            ...d,
                            projektnummer,
                            baustellenort: projektnummer.length === 7 && !d.baustellenort ? placeForProject(projektnummer) : d.baustellenort,
                        }));
                    }}
                />
            </Field>
            <Field label="Bericht-Nr.">
                <Input inputMode="numeric" placeholder="z. B. 1" value={draft.berichtNr} onChange={(event) => update({ berichtNr: onlyDigits(event.target.value, 6) })} />
            </Field>
            <Field label="Bauvorhaben" wide>
                <Input placeholder="Bauvorhaben" value={draft.bauvorhaben} onChange={(event) => update({ bauvorhaben: event.target.value })} />
            </Field>
            <Field label="Leitender Monteur" wide>
                <div className="input-with-button">
                    <Input placeholder="Name" value={draft.leitenderMonteur} onChange={(event) => update({ leitenderMonteur: event.target.value })} />
                    {employees.length > 0 && (
                        <Button isSecondary icon="fa fa-list" onClick={() => void pickMonteur()}>
                            Liste
                        </Button>
                    )}
                </div>
            </Field>
        </div>
    );
}

// Datum, Zeit, Wetter ---------------------------------------------------------

const WEATHER_LABELS: { key: keyof Draft['wetter']; label: string }[] = [
    { key: 'regen', label: 'Regen' },
    { key: 'frost', label: 'Frost' },
    { key: 'schnee', label: 'Schnee' },
    { key: 'sonne', label: 'Sonne' },
    { key: 'wind', label: 'Wind' },
];

export function TimeWeatherSection({ draft, update }: SectionProps) {
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const loadWeather = async () => {
        if (!draft.baustellenort.trim()) {
            setError('Bitte zuerst den Baustellenort (Ort oder PLZ) eintragen.');
            return;
        }
        setIsLoading(true);
        setError(null);
        try {
            const result = await fetchWeather(draft.baustellenort, draft.datum);
            rememberPlace(draft.projektnummer, draft.baustellenort);
            update({ wetter: result.flags, temperatur: result.temperatur });
            toast(`Wetter für ${result.placeName} übernommen. Bitte prüfen.`);
        } catch (err) {
            setError(getErrorMessage(err));
        } finally {
            setIsLoading(false);
        }
    };

    const time = (key: 'beginn' | 'ende', label: string) => (
        <Field label={label}>
            <ComboBox
                placeholder="--:--"
                lists={[{ list: QUARTER_HOURS }]}
                selectedItem={QUARTER_HOURS.find((item) => item.value === draft[key])}
                onSelect={(item) => update({ [key]: item ? String(item.value) : '' })}
                shouldUseFullWidth
                shouldShowClearIcon
                maxHeight={240}
            />
        </Field>
    );

    return (
        <div className="stack">
            <div className="form-grid">
                <Field label="Datum" hint={weekdayOf(draft.datum)}>
                    <Input type="date" value={draft.datum} onChange={(event) => update({ datum: event.target.value })} />
                </Field>
                {time('beginn', 'Beginn')}
                {time('ende', 'Ende')}
            </div>
            <div className="form-grid">
                <Field label="Baustellenort (für das Wetter)" hint="Ort oder PLZ, wird je Projekt gemerkt" wide>
                    <div className="input-with-button">
                        <Input placeholder="z. B. 46395 oder Bocholt" value={draft.baustellenort} onChange={(event) => update({ baustellenort: event.target.value })} />
                        <Button isSecondary icon="fa fa-cloud-sun" shouldShowWaitCursor={isLoading} onClick={() => void loadWeather()}>
                            Wetter abrufen
                        </Button>
                    </div>
                </Field>
            </div>
            {error && <Notice type="error">{error}</Notice>}
            <div className="checkbox-row">
                {WEATHER_LABELS.map(({ key, label }) => (
                    <Checkbox key={key} isChecked={draft.wetter[key]} onChange={(event) => update((d) => ({ ...d, wetter: { ...d.wetter, [key]: event.target.checked } }))}>
                        {label}
                    </Checkbox>
                ))}
            </div>
            <div className="form-grid">
                <Field label="Temperatur">
                    <Input placeholder="z. B. 12 °C" value={draft.temperatur} onChange={(event) => update({ temperatur: event.target.value })} />
                </Field>
                <Field label="Sonstiges (Witterung)" wide>
                    <Input placeholder="z. B. Nebel" value={draft.wetterSonstiges} onChange={(event) => update({ wetterSonstiges: event.target.value })} />
                </Field>
            </div>
        </div>
    );
}

// Mitarbeiter -----------------------------------------------------------------

export function StaffSection({ draft, update, employees }: SectionProps & { employees: string[] }) {
    const full = draft.mitarbeiter.length >= FORM_LIMITS.mitarbeiter;
    const pick = async () => {
        const result = await selectDialog('Mitarbeiter auswählen', employees, draft.mitarbeiter, true);
        if (!result) return;
        // Reihenfolge der bisherigen Einträge behalten, neue hinten anfügen.
        const kept = draft.mitarbeiter.filter((name) => result.includes(name) || !employees.includes(name));
        const added = result.filter((name) => !kept.includes(name));
        const next = [...kept, ...added];
        if (next.length > FORM_LIMITS.mitarbeiter) toast(`Das Formular hat Platz für ${FORM_LIMITS.mitarbeiter} Mitarbeiter.`, 'error');
        update({ mitarbeiter: next.slice(0, FORM_LIMITS.mitarbeiter) });
    };
    return (
        <div className="stack">
            {draft.mitarbeiter.length === 0 && <p className="hint-text">Noch keine Mitarbeiter eingetragen.</p>}
            {draft.mitarbeiter.map((name, i) => (
                <div className="row-item" key={i}>
                    <span className="row-item__index">{i + 1}</span>
                    <Input
                        placeholder="Name"
                        value={name}
                        onChange={(event) => update((d) => ({ ...d, mitarbeiter: d.mitarbeiter.map((n, j) => (j === i ? event.target.value : n)) }))}
                    />
                    <Icon icons={['fa fa-xmark']} size={18} onClick={() => update((d) => ({ ...d, mitarbeiter: d.mitarbeiter.filter((_, j) => j !== i) }))} />
                </div>
            ))}
            <div className="button-row">
                {employees.length > 0 && (
                    <Button icon="fa fa-users" onClick={() => void pick()}>
                        Aus Liste wählen
                    </Button>
                )}
                <Button isSecondary icon="fa fa-plus" isDisabled={full} onClick={() => update((d) => ({ ...d, mitarbeiter: [...d.mitarbeiter, ''] }))}>
                    Name eintragen
                </Button>
                <span className="hint-text">
                    {draft.mitarbeiter.length} von {FORM_LIMITS.mitarbeiter}
                </span>
            </div>
        </div>
    );
}

// Ausgeführte Arbeiten --------------------------------------------------------

function appendRows<T>(rows: T[], incoming: T[], isEmpty: (row: T) => boolean): T[] {
    const kept = rows.filter((row) => !isEmpty(row));
    return [...kept, ...incoming];
}

const isEmptyWork = (row: WorkRow) => !row.beschreibung.trim() && !row.bauteil.trim() && !row.geschoss.trim() && !row.ansicht.trim();
const isEmptyExtra = (row: ExtraRow) => !row.beschreibung.trim() && !row.mitarbeiter.trim() && !row.stunden.trim();

export function WorkSection({ draft, update, bridgeUrl }: SectionProps & { bridgeUrl: string | null }) {
    const [dictating, setDictating] = useState(false);
    const layout = useMemo(() => layoutWork(draft.arbeiten), [draft.arbeiten]);
    const setRow = (i: number, change: Partial<WorkRow>) =>
        update((d) => ({ ...d, arbeiten: d.arbeiten.map((row, j) => (j === i ? { ...row, ...change } : row)) }));

    const apply = (result: AiResult) => {
        const rows = result.rows.map((row) => ({
            beschreibung: row.beschreibung ?? '',
            bauteil: row.bauteil ?? '',
            geschoss: row.geschoss ?? '',
            ansicht: row.ansicht ?? '',
        }));
        update((d) => ({ ...d, arbeiten: appendRows(d.arbeiten, rows, isEmptyWork) }));
    };

    return (
        <div className="stack">
            {draft.arbeiten.map((row, i) => (
                <div className="entry" key={i}>
                    <div className="entry__head">
                        <span className="row-item__index">{i + 1}</span>
                        <Input placeholder="Ausgeführte Arbeit" value={row.beschreibung} onChange={(event) => setRow(i, { beschreibung: event.target.value })} />
                        <Icon icons={['fa fa-xmark']} size={18} onClick={() => update((d) => ({ ...d, arbeiten: d.arbeiten.filter((_, j) => j !== i) }))} />
                    </div>
                    <div className="entry__cols">
                        <Input placeholder="Bauteil" value={row.bauteil} onChange={(event) => setRow(i, { bauteil: event.target.value })} />
                        <Input placeholder="Geschoss" value={row.geschoss} onChange={(event) => setRow(i, { geschoss: event.target.value })} />
                        <Input placeholder="Ansicht" value={row.ansicht} onChange={(event) => setRow(i, { ansicht: event.target.value })} />
                    </div>
                </div>
            ))}
            {!layout.fits && <Notice type="warning">Zu viel Text für das Formular. Bitte Einträge kürzen oder zusammenfassen.</Notice>}
            {dictating ? (
                <DictationPanel
                    mode="work"
                    bridgeUrl={bridgeUrl}
                    title="Ausgeführte Arbeiten diktieren"
                    freeRows={Math.max(0, layout.max - layout.used)}
                    onApply={apply}
                    onClose={() => setDictating(false)}
                />
            ) : (
                <div className="button-row">
                    <Button icon="fa fa-microphone" onClick={() => setDictating(true)}>
                        Diktieren
                    </Button>
                    <Button isSecondary icon="fa fa-plus" isDisabled={layout.used >= layout.max} onClick={() => update((d) => ({ ...d, arbeiten: [...d.arbeiten, emptyWorkRow()] }))}>
                        Zeile
                    </Button>
                    <LineUsage used={layout.used} max={layout.max} />
                </div>
            )}
        </div>
    );
}

// Zusätzliche Arbeiten --------------------------------------------------------

export function ExtraSection({ draft, update, bridgeUrl }: SectionProps & { bridgeUrl: string | null }) {
    const [dictating, setDictating] = useState(false);
    const layout = useMemo(() => layoutExtra(draft.zusatz), [draft.zusatz]);
    const hours = totalExtraHours(draft.zusatz);
    const setRow = (i: number, change: Partial<ExtraRow>) =>
        update((d) => ({ ...d, zusatz: d.zusatz.map((row, j) => (j === i ? { ...row, ...change } : row)) }));

    const apply = (result: AiResult) => {
        const rows = result.rows.map((row) => ({
            beschreibung: row.beschreibung ?? '',
            mitarbeiter: (row.mitarbeiter ?? '').replace(/[^\d]/g, ''),
            stunden: (row.stunden ?? '').replace('.', ','),
        }));
        update((d) => ({ ...d, zusatz: appendRows(d.zusatz, rows, isEmptyExtra) }));
    };

    return (
        <div className="stack">
            <Checkbox isChecked={draft.zusatzAufAnweisung} onChange={(event) => update({ zusatzAufAnweisung: event.target.checked })}>
                Auf Anweisung der Bauleitung
            </Checkbox>
            {draft.zusatz.map((row, i) => (
                <div className="entry" key={i}>
                    <div className="entry__head">
                        <span className="row-item__index">{i + 1}</span>
                        <Input placeholder="Zusätzliche Arbeit" value={row.beschreibung} onChange={(event) => setRow(i, { beschreibung: event.target.value })} />
                        <Icon icons={['fa fa-xmark']} size={18} onClick={() => update((d) => ({ ...d, zusatz: d.zusatz.filter((_, j) => j !== i) }))} />
                    </div>
                    <div className="entry__cols entry__cols--two">
                        <Input inputMode="numeric" placeholder="Mitarbeiter (Anzahl)" value={row.mitarbeiter} onChange={(event) => setRow(i, { mitarbeiter: onlyDigits(event.target.value, 3) })} />
                        <Input
                            inputMode="decimal"
                            placeholder="Std. / Person"
                            value={row.stunden}
                            onChange={(event) => setRow(i, { stunden: event.target.value.replace(/[^\d,.]/g, '').slice(0, 6) })}
                        />
                    </div>
                </div>
            ))}
            {hours !== null && (
                <p className="total-row">
                    Stunden gesamt: <strong>{formatHours(hours)}</strong>
                </p>
            )}
            {!layout.fits && <Notice type="warning">Zu viel Text für das Formular. Bitte Einträge kürzen.</Notice>}
            {dictating ? (
                <DictationPanel
                    mode="extra"
                    bridgeUrl={bridgeUrl}
                    title="Zusätzliche Arbeiten diktieren"
                    freeRows={Math.max(0, layout.max - layout.used)}
                    onApply={apply}
                    onClose={() => setDictating(false)}
                />
            ) : (
                <div className="button-row">
                    <Button icon="fa fa-microphone" onClick={() => setDictating(true)}>
                        Diktieren
                    </Button>
                    <Button isSecondary icon="fa fa-plus" isDisabled={layout.used >= layout.max} onClick={() => update((d) => ({ ...d, zusatz: [...d.zusatz, emptyExtraRow()] }))}>
                        Zeile
                    </Button>
                    <LineUsage used={layout.used} max={layout.max} />
                </div>
            )}
        </div>
    );
}

// Besondere Vorkommnisse ------------------------------------------------------

export function EventsSection({ draft, update, bridgeUrl }: SectionProps & { bridgeUrl: string | null }) {
    const [dictating, setDictating] = useState(false);
    const layout = useMemo(() => layoutEvents(draft.vorkommnisse), [draft.vorkommnisse]);
    const apply = (result: AiResult) => {
        const text = result.rows.map((row) => row.beschreibung).filter(Boolean).join('\n');
        update((d) => ({ ...d, vorkommnisse: [d.vorkommnisse.trim(), text].filter(Boolean).join('\n') }));
    };
    return (
        <div className="stack">
            <TextArea
                placeholder="Behinderungen, Mängel, Wartezeiten, Anweisungen … (eine Zeile je Vorkommnis)"
                value={draft.vorkommnisse}
                minHeight={110}
                isInvalid={!layout.fits}
                onChange={(event) => update({ vorkommnisse: event.target.value })}
            />
            {dictating ? (
                <DictationPanel mode="events" bridgeUrl={bridgeUrl} title="Besondere Vorkommnisse diktieren" onApply={apply} onClose={() => setDictating(false)} />
            ) : (
                <div className="button-row">
                    <Button icon="fa fa-microphone" onClick={() => setDictating(true)}>
                        Diktieren
                    </Button>
                    <LineUsage used={layout.used} max={layout.max} />
                </div>
            )}
        </div>
    );
}

/** Kleines Kennzeichen rechts im Aufklapper. */
export function CountBadge({ value }: { value: string | number | null }) {
    if (value === null || value === '' || value === 0) return null;
    return <Badge size={BadgeSize.SMALL}>{value}</Badge>;
}
