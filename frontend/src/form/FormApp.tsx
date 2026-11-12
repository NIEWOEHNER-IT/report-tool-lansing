/**
 * Bautagesbericht-Formular (Seite für Mitarbeiter der Gruppe Team).
 * Abschnitte als chayns-Aufklapper; der Entwurf wird laufend im Gerät gespeichert.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Accordion, AccordionContent } from '@chayns-components/core';
import { formatDayKey, type SettingsResponse } from '../../../shared/contract';
import { authRequest } from '../common/api';
import { confirmDialog } from '../common/dialogs';
import { Notice } from '../common/Notice';
import type { ShellContext } from '../common/Shell';
import { emptyDraft, formatHours, loadDraft, nextDraft, saveDraft, totalExtraHours, type Draft } from './draft';
import { MyReports } from './MyReports';
import { layoutEvents, layoutWork } from './pdf/layout';
import { prunePhotos } from './photoStore';
import { PhotosSection } from './PhotosSection';
import { CountBadge, EventsSection, ExtraSection, ProjectSection, StaffSection, TimeWeatherSection, WorkSection, type Update } from './sections';
import { SignatureSection } from './SignatureSection';
import { SubmitSection } from './SubmitSection';
import type { SubmitResult } from './submit';
import { useEnterToNext } from './useEnterToNext';

export function FormApp({ context }: { context: ShellContext }) {
    const [draft, setDraft] = useState<Draft>(loadDraft);
    const [employees, setEmployees] = useState<string[]>([]);
    const [result, setResult] = useState<SubmitResult | null>(null);
    const [storageWarning, setStorageWarning] = useState(false);
    const [reportsVersion, setReportsVersion] = useState(0);
    // Schlüssel für die Unterschriftenfelder: nach "Nächster Bericht" neu aufbauen.
    const [formKey, setFormKey] = useState(0);
    const firstRender = useRef(true);
    const pageRef = useRef<HTMLDivElement>(null);
    useEnterToNext(pageRef, formKey);

    useEffect(() => {
        authRequest<SettingsResponse>('GET', '/api/settings')
            .then((settings) => setEmployees(settings.employees))
            .catch(() => setEmployees([]));
        void prunePhotos(loadDraft().photos.map((p) => p.id));
    }, []);

    // Entwurf automatisch sichern (kurz verzögert, damit Tippen flüssig bleibt).
    useEffect(() => {
        if (firstRender.current) {
            firstRender.current = false;
            return;
        }
        const timer = window.setTimeout(() => setStorageWarning(!saveDraft(draft)), 300);
        return () => window.clearTimeout(timer);
    }, [draft]);

    const update: Update = useCallback((change) => {
        setResult(null);
        setDraft((current) => (typeof change === 'function' ? change(current) : { ...current, ...change }));
    }, []);

    const replaceDraft = (next: Draft) => {
        setResult(null);
        setDraft(next);
        saveDraft(next);
        setFormKey((k) => k + 1);
        void prunePhotos(next.photos.map((p) => p.id));
    };

    const clear = async () => {
        if (!result && !(await confirmDialog('Alle Eingaben dieses Berichts löschen?', 'Löschen'))) return;
        replaceDraft(emptyDraft());
    };

    const onSubmitted = (submitted: SubmitResult) => {
        setResult(submitted);
        setReportsVersion((v) => v + 1);
    };

    const bridgeUrl = context.bootstrap.bridgeUrl;
    const workUsed = useMemo(() => layoutWork(draft.arbeiten).used, [draft.arbeiten]);
    const eventsUsed = useMemo(() => layoutEvents(draft.vorkommnisse).used, [draft.vorkommnisse]);
    const hours = totalExtraHours(draft.zusatz);
    const signatures = [draft.unterschriftAuftraggeber.image, draft.unterschriftLansing.image].filter(Boolean).length;
    const sectionProps = { draft, update };

    return (
        <div className="page" key={formKey} ref={pageRef}>
            <div className="page-head">
                <h1>Bautagesbericht</h1>
                <span className="hint-text">Angemeldet als {context.identity.personName ?? 'Mitarbeiter'}</span>
            </div>
            {storageWarning && <Notice type="warning">Der Entwurf konnte auf diesem Gerät nicht gesichert werden. Bitte den Bericht zeitnah speichern.</Notice>}

            <div className="sections">
                <Accordion title="Projekt" icon="fa fa-folder-open" isDefaultOpen rightElement={<CountBadge value={draft.projektnummer || null} />}>
                    <AccordionContent>
                        <ProjectSection {...sectionProps} employees={employees} />
                    </AccordionContent>
                </Accordion>
                <Accordion title="Datum, Zeit und Wetter" icon="fa fa-calendar-day" isDefaultOpen rightElement={<CountBadge value={formatDayKey(draft.datum)} />}>
                    <AccordionContent>
                        <TimeWeatherSection {...sectionProps} />
                    </AccordionContent>
                </Accordion>
                <Accordion title="Mitarbeiter" icon="fa fa-users" rightElement={<CountBadge value={draft.mitarbeiter.filter(Boolean).length} />}>
                    <AccordionContent>
                        <StaffSection {...sectionProps} employees={employees} />
                    </AccordionContent>
                </Accordion>
                <Accordion title="Ausgeführte Arbeiten" icon="fa fa-screwdriver-wrench" rightElement={<CountBadge value={workUsed} />}>
                    <AccordionContent>
                        <WorkSection {...sectionProps} bridgeUrl={bridgeUrl} />
                    </AccordionContent>
                </Accordion>
                <Accordion title="Zusätzliche Arbeiten" icon="fa fa-clock" rightElement={<CountBadge value={hours !== null ? `${formatHours(hours)} Std.` : null} />}>
                    <AccordionContent>
                        <ExtraSection {...sectionProps} bridgeUrl={bridgeUrl} />
                    </AccordionContent>
                </Accordion>
                <Accordion title="Besondere Vorkommnisse" icon="fa fa-triangle-exclamation" rightElement={<CountBadge value={eventsUsed} />}>
                    <AccordionContent>
                        <EventsSection {...sectionProps} bridgeUrl={bridgeUrl} />
                    </AccordionContent>
                </Accordion>
                <Accordion title="Fotos" icon="fa fa-camera" rightElement={<CountBadge value={draft.photos.length} />}>
                    <AccordionContent>
                        <PhotosSection {...sectionProps} bridgeUrl={bridgeUrl} />
                    </AccordionContent>
                </Accordion>
                <Accordion title="Unterschriften" icon="fa fa-signature" rightElement={<CountBadge value={signatures ? `${signatures} / 2` : null} />}>
                    <AccordionContent>
                        <SignatureSection {...sectionProps} />
                    </AccordionContent>
                </Accordion>
                <Accordion title="Speichern" icon="fa fa-cloud-arrow-up" isDefaultOpen>
                    <AccordionContent>
                        <SubmitSection
                            draft={draft}
                            result={result}
                            onSubmitted={onSubmitted}
                            onNext={() => replaceDraft(nextDraft(draft))}
                            onClear={() => void clear()}
                        />
                    </AccordionContent>
                </Accordion>
                <Accordion title="Meine Berichte" icon="fa fa-folder-tree">
                    <AccordionContent>
                        <MyReports refreshKey={reportsVersion} />
                    </AccordionContent>
                </Accordion>
            </div>
        </div>
    );
}
