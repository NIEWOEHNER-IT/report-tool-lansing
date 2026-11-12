/**
 * Unterschriftenfeld (Finger oder Apple Pencil). Seitenverhältnis wie das Unterschriftsfeld
 * im A4-Formular, damit die Unterschrift im PDF nicht verzerrt wird.
 */
import { useEffect, useRef } from 'react';
import { Button } from '@chayns-components/core';

const WIDTH = 960;
const HEIGHT = 300;

export interface SignaturePadProps {
    value: string | null;
    onChange: (value: string | null) => void;
    isDisabled?: boolean;
}

function hasInk(canvas: HTMLCanvasElement): boolean {
    const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let i = 3; i < data.length; i += 4) if (data[i]! > 0) return true;
    return false;
}

export function SignaturePad({ value, onChange, isDisabled }: SignaturePadProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const drawing = useRef(false);
    const lastValue = useRef<string | null>(null);

    // Gespeicherte Unterschrift zeichnen (nur wenn sie sich von außen geändert hat).
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || value === lastValue.current) return;
        const ctx = canvas.getContext('2d')!;
        ctx.clearRect(0, 0, WIDTH, HEIGHT);
        lastValue.current = value;
        if (value) {
            const img = new Image();
            img.onload = () => ctx.drawImage(img, 0, 0, WIDTH, HEIGHT);
            img.src = value;
        }
    }, [value]);

    const point = (event: React.PointerEvent<HTMLCanvasElement>) => {
        const rect = event.currentTarget.getBoundingClientRect();
        return { x: ((event.clientX - rect.left) * WIDTH) / rect.width, y: ((event.clientY - rect.top) * HEIGHT) / rect.height };
    };

    const start = (event: React.PointerEvent<HTMLCanvasElement>) => {
        if (isDisabled) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        drawing.current = true;
        const ctx = event.currentTarget.getContext('2d')!;
        ctx.lineWidth = 5;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = '#152333';
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
        if (!drawing.current) return;
        drawing.current = false;
        const canvas = canvasRef.current!;
        const next = hasInk(canvas) ? canvas.toDataURL('image/png') : null;
        lastValue.current = next;
        onChange(next);
    };

    const clear = () => {
        const canvas = canvasRef.current!;
        canvas.getContext('2d')!.clearRect(0, 0, WIDTH, HEIGHT);
        lastValue.current = null;
        onChange(null);
    };

    return (
        <div className="signature">
            <canvas
                ref={canvasRef}
                className={`signature__canvas${isDisabled ? ' signature__canvas--disabled' : ''}`}
                width={WIDTH}
                height={HEIGHT}
                onPointerDown={start}
                onPointerMove={move}
                onPointerUp={end}
                onPointerCancel={end}
                onLostPointerCapture={end}
                aria-label="Unterschriftenfeld"
            />
            <div className="signature__footer">
                <span className="hint-text">{value ? 'Unterschrieben' : 'Hier unterschreiben'}</span>
                {value && (
                    <Button isSecondary icon="fa fa-eraser" onClick={clear}>
                        Löschen
                    </Button>
                )}
            </div>
        </div>
    );
}
