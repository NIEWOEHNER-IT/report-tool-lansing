/**
 * Fotos: aufnehmen/auswählen, mit Stift bearbeiten, Beschreibung (auch per Diktat mit KI).
 * Im PDF bekommt jedes Foto eine eigene Seite "Bilddokumentation".
 */
import { useEffect, useState } from 'react';
import { Button, selectFiles, TextArea } from '@chayns-components/core';
import { FORM_LIMITS } from '../../../shared/contract';
import { getErrorMessage } from '../common/api';
import { confirmDialog } from '../common/dialogs';
import { Notice } from '../common/Notice';
import { DictationPanel } from './components/DictationPanel';
import { PhotoEditor } from './components/PhotoEditor';
import { newClientId, type DraftPhoto } from './draft';
import { flattenPhoto, resizePhoto } from './image';
import { captionFits } from './pdf/render';
import { deletePhoto, getPhoto, putPhoto, type StoredPhoto } from './photoStore';
import type { SectionProps } from './sections';

function Thumb({ photo, version }: { photo: DraftPhoto; version: number }) {
    const [url, setUrl] = useState<string | null>(null);
    const [missing, setMissing] = useState(false);
    useEffect(() => {
        let objectUrl: string | null = null;
        let cancelled = false;
        void (async () => {
            const stored = await getPhoto(photo.id);
            if (cancelled) return;
            if (!stored) {
                setMissing(true);
                return;
            }
            objectUrl = URL.createObjectURL(await flattenPhoto(stored.original, stored.annotation, 0.7));
            if (!cancelled) setUrl(objectUrl);
        })();
        return () => {
            cancelled = true;
            if (objectUrl) URL.revokeObjectURL(objectUrl);
        };
    }, [photo.id, version]);
    if (missing) return <div className="photo__thumb photo__thumb--missing">Bild fehlt auf diesem Gerät</div>;
    return url ? <img className="photo__thumb" src={url} alt="" /> : <div className="photo__thumb" />;
}

export function PhotosSection({ draft, update, bridgeUrl }: SectionProps & { bridgeUrl: string | null }) {
    const [editing, setEditing] = useState<{ id: string; stored: StoredPhoto } | null>(null);
    const [dictating, setDictating] = useState<string | null>(null);
    const [isAdding, setIsAdding] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [versions, setVersions] = useState<Record<string, number>>({});

    const setCaption = (id: string, caption: string) =>
        update((d) => ({ ...d, photos: d.photos.map((p) => (p.id === id ? { ...p, caption } : p)) }));

    const add = async () => {
        setError(null);
        let files: File[];
        try {
            files = await selectFiles({ type: 'image/*', multiple: true });
        } catch {
            return;
        }
        const free = FORM_LIMITS.fotos - draft.photos.length;
        if (files.length > free) setError(`Es passen höchstens ${FORM_LIMITS.fotos} Fotos in einen Bericht.`);
        setIsAdding(true);
        try {
            const added: DraftPhoto[] = [];
            for (const file of files.slice(0, free)) {
                const id = newClientId();
                await putPhoto(id, { original: await resizePhoto(file), annotation: null });
                added.push({ id, caption: '', annotated: false });
            }
            update((d) => ({ ...d, photos: [...d.photos, ...added] }));
        } catch (err) {
            setError(getErrorMessage(err));
        } finally {
            setIsAdding(false);
        }
    };

    const remove = async (photo: DraftPhoto, index: number) => {
        if (!(await confirmDialog(`Bild ${index + 1} aus dem Bericht entfernen?`, 'Entfernen'))) return;
        await deletePhoto(photo.id);
        update((d) => ({ ...d, photos: d.photos.filter((p) => p.id !== photo.id) }));
    };

    const edit = async (photo: DraftPhoto) => {
        const stored = await getPhoto(photo.id);
        if (stored) setEditing({ id: photo.id, stored });
    };

    const saveEdit = async (annotation: Blob | null) => {
        if (!editing) return;
        await putPhoto(editing.id, { ...editing.stored, annotation });
        update((d) => ({ ...d, photos: d.photos.map((p) => (p.id === editing.id ? { ...p, annotated: !!annotation } : p)) }));
        setVersions((v) => ({ ...v, [editing.id]: (v[editing.id] ?? 0) + 1 }));
        setEditing(null);
    };

    if (editing) {
        return (
            <PhotoEditor original={editing.stored.original} annotation={editing.stored.annotation} onSave={(a) => void saveEdit(a)} onCancel={() => setEditing(null)} />
        );
    }

    return (
        <div className="stack">
            {draft.photos.length === 0 && <p className="hint-text">Noch keine Fotos. Fotos werden nur mit diesem Bericht gespeichert.</p>}
            <div className="photos">
                {draft.photos.map((photo, i) => (
                    <div className="photo" key={photo.id}>
                        <Thumb photo={photo} version={versions[photo.id] ?? 0} />
                        <div className="photo__body">
                            <strong>
                                Bild {i + 1}
                                {photo.annotated ? ' · bearbeitet' : ''}
                            </strong>
                            <TextArea
                                placeholder="Bildbeschreibung"
                                value={photo.caption}
                                minHeight={60}
                                isInvalid={!captionFits(photo.caption)}
                                onChange={(event) => setCaption(photo.id, event.target.value)}
                            />
                            {dictating === photo.id ? (
                                <DictationPanel
                                    mode="photo"
                                    bridgeUrl={bridgeUrl}
                                    title={`Beschreibung Bild ${i + 1} diktieren`}
                                    onApply={(result) => setCaption(photo.id, result.text ?? '')}
                                    onClose={() => setDictating(null)}
                                />
                            ) : (
                                <div className="button-row">
                                    <Button isSecondary icon="fa fa-pen" onClick={() => void edit(photo)}>
                                        Zeichnen
                                    </Button>
                                    <Button isSecondary icon="fa fa-microphone" onClick={() => setDictating(photo.id)}>
                                        Diktieren
                                    </Button>
                                    <Button isSecondary icon="fa fa-trash" onClick={() => void remove(photo, i)}>
                                        Entfernen
                                    </Button>
                                </div>
                            )}
                        </div>
                    </div>
                ))}
            </div>
            {error && <Notice type="warning">{error}</Notice>}
            <div className="button-row">
                <Button icon="fa fa-camera" shouldShowWaitCursor={isAdding} isDisabled={draft.photos.length >= FORM_LIMITS.fotos} onClick={() => void add()}>
                    Fotos hinzufügen
                </Button>
                <span className="hint-text">
                    {draft.photos.length} von {FORM_LIMITS.fotos}
                </span>
            </div>
        </div>
    );
}
