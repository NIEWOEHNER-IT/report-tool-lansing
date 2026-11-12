/** Feld mit kleiner Beschriftung darüber (Formular-Layout). */
import type { ReactNode } from 'react';

export function Field({ label, hint, children, wide }: { label: string; hint?: ReactNode; children: ReactNode; wide?: boolean }) {
    return (
        <label className={`field${wide ? ' field--wide' : ''}`}>
            <span className="field__label">{label}</span>
            {children}
            {hint && <span className="field__hint">{hint}</span>}
        </label>
    );
}

/** "PDF-Zeilen: x von y" mit Warnung bei Überlauf. */
export function LineUsage({ used, max }: { used: number; max: number }) {
    return (
        <span className={`line-usage${used > max ? ' line-usage--over' : ''}`}>
            PDF-Zeilen: {used} von {max}
        </span>
    );
}
