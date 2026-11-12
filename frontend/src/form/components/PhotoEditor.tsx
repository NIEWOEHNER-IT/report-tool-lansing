/**
 * Zeichnen auf einem Foto (Apple Pencil oder Finger), wie "Bild mit Apple Pencil bearbeiten" in V46.
 * Die Zeichnung liegt als eigene transparente Ebene über dem Original und bleibt änderbar.
 */
import { useEffect, useRef, useState } from 'react';
import { Button } from '@chayns-components/core';
import { canvasToBlob, loadImage } from '../image';

const COLORS = [
    { id: 'rot', value: '#d62828', label: 'Rot' },
    { id: 'gelb', value: '#f6c000', label: 'Gelb' },
    { id: 'schwarz', value: '#111111', label: 'Schwarz' },
    { id: 'weiss', value: '#ffffff', label: 'Weiß' },
];
const WIDTHS = [
    { id: 'fein', factor: 0.004, label: 'Fein' },
    { id: 'mittel', factor: 0.008, label: 'Mittel' },
    { id: 'dick', factor: 0.014, label: 'Dick' },
];

export interface PhotoEditorProps {
    original: Blob;
    annotation: Blob | null;
    onSave: (annotation: Blob | null) => void;
    onCancel: () => void;
}

export function PhotoEditor({ original, annotation, onSave, onCancel }: PhotoEditorProps) {
    const baseRef = useRef<HTMLCanvasElement>(null);
    const layerRef = useRef<HTMLCanvasElement>(null);
    const history = useRef<ImageData[]>([]);
    const drawing = useRef(false);
    const [color, setColor] = useState(COLORS[0]!.value);
    const [width, setWidth] = useState(WIDTHS[1]!.factor);
    const [ready, setReady] = useState(false);
    const [canUndo, setCanUndo] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            const img = await loadImage(original);
            if (cancelled) return;
            for (const canvas of [baseRef.current!, layerRef.current!]) {
                canvas.width = img.naturalWidth;
                canvas.height = img.naturalHeight;
            }
            baseRef.current!.getContext('2d')!.drawImage(img, 0, 0);
            if (annotation) {
                const layer = await loadImage(annotation);
                if (!cancelled) layerRef.current!.getContext('2d')!.drawImage(layer, 0, 0, img.naturalWidth, img.naturalHeight);
            }
            if (!cancelled) setReady(true);
        })();
        return () => {
            cancelled = true;
        };
    }, [original, annotation]);

    const point = (event: React.PointerEvent<HTMLCanvasElement>) => {
        const canvas = event.currentTarget;
        const rect = canvas.getBoundingClientRect();
        return { x: ((event.clientX - rect.left) * canvas.width) / rect.width, y: ((event.clientY - rect.top) * canvas.height) / rect.height };
    };

    const start = (event: React.PointerEvent<HTMLCanvasElement>) => {
        if (!ready) return;
        event.preventDefault();
        const canvas = event.currentTarget;
        canvas.setPointerCapture(event.pointerId);
        const ctx = canvas.getContext('2d')!;
        history.current.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
        if (history.current.length > 15) history.current.shift();
        setCanUndo(true);
        drawing.current = true;
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(3, Math.max(canvas.width, canvas.height) * width);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        const p = point(event);
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x + 0.1, p.y + 0.1);
        ctx.stroke();
    };

    const move = (event: React.PointerEvent<HTMLCanvasElement>) => {
        if (!drawing.current) return;
        event.preventDefault();
        const ctx = event.currentTarget.getContext('2d')!;
        const p = point(event);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
    };

    const end = () => {
        drawing.current = false;
    };

    const undo = () => {
        const last = history.current.pop();
        if (last) layerRef.current!.getContext('2d')!.putImageData(last, 0, 0);
        setCanUndo(history.current.length > 0);
    };

    const clearAll = () => {
        const canvas = layerRef.current!;
        const ctx = canvas.getContext('2d')!;
        history.current.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        setCanUndo(true);
    };

    const save = async () => {
        setIsSaving(true);
        const canvas = layerRef.current!;
        const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
        let ink = false;
        for (let i = 3; i < data.length; i += 4) {
            if (data[i]! > 0) {
                ink = true;
                break;
            }
        }
        onSave(ink ? await canvasToBlob(canvas, 'image/png') : null);
        setIsSaving(false);
    };

    return (
        <div className="photo-editor">
            <div className="photo-editor__tools">
                {COLORS.map((c) => (
                    <button
                        key={c.id}
                        type="button"
                        className={`swatch${c.value === color ? ' swatch--active' : ''}`}
                        style={{ background: c.value }}
                        aria-label={c.label}
                        title={c.label}
                        onClick={() => setColor(c.value)}
                    />
                ))}
                <span className="photo-editor__sep" />
                {WIDTHS.map((w) => (
                    <Button key={w.id} isSecondary={w.factor !== width} onClick={() => setWidth(w.factor)}>
                        {w.label}
                    </Button>
                ))}
            </div>
            <div className="photo-editor__stage">
                <canvas ref={baseRef} className="photo-editor__base" />
                <canvas
                    ref={layerRef}
                    className="photo-editor__layer"
                    onPointerDown={start}
                    onPointerMove={move}
                    onPointerUp={end}
                    onPointerCancel={end}
                    onLostPointerCapture={end}
                />
            </div>
            <div className="button-row">
                <Button isSecondary icon="fa fa-rotate-left" isDisabled={!canUndo} onClick={undo}>
                    Rückgängig
                </Button>
                <Button isSecondary icon="fa fa-trash" onClick={clearAll}>
                    Zeichnung löschen
                </Button>
                <span className="spacer" />
                <Button isSecondary onClick={onCancel}>
                    Abbrechen
                </Button>
                <Button icon="fa fa-check" shouldShowWaitCursor={isSaving} onClick={() => void save()}>
                    Übernehmen
                </Button>
            </div>
        </div>
    );
}
