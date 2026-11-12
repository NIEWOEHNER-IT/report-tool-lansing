/**
 * Enter in einem einzeiligen Eingabefeld springt ins nächste sichtbare Feld des Formulars
 * (wie die "Weiter"-Taste auf dem iPad). Textbereiche behalten Enter für neue Zeilen.
 * Gibt es kein weiteres sichtbares Feld, wird die Tastatur geschlossen.
 */
import { useEffect, type RefObject } from 'react';

const TEXT_TYPES = new Set(['text', 'email', 'tel', 'number', 'search', 'url', 'date', 'time', '']);

function isTextInput(el: Element | null): el is HTMLInputElement {
    return el instanceof HTMLInputElement && TEXT_TYPES.has(el.type) && !el.readOnly && !el.disabled;
}

function isVisible(el: HTMLElement): boolean {
    if (el.getClientRects().length === 0) return false;
    const style = window.getComputedStyle(el);
    return style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) !== 0;
}

function focusableFields(root: HTMLElement): HTMLElement[] {
    return Array.from(root.querySelectorAll<HTMLElement>('input, textarea')).filter(
        (el) => (isTextInput(el) || (el instanceof HTMLTextAreaElement && !el.disabled && !el.readOnly)) && isVisible(el),
    );
}

export function useEnterToNext(ref: RefObject<HTMLElement>, resetKey: unknown = null): void {
    useEffect(() => {
        const root = ref.current;
        if (!root) return;

        // iPad/iPhone: Eingabetaste als "Weiter" beschriften.
        const onFocusIn = (event: FocusEvent) => {
            if (isTextInput(event.target as Element)) (event.target as HTMLElement).setAttribute('enterkeyhint', 'next');
        };

        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key !== 'Enter' || event.isComposing || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return;
            const current = event.target as Element;
            if (!isTextInput(current)) return;
            event.preventDefault();
            const fields = focusableFields(root);
            const next = fields[fields.indexOf(current) + 1];
            if (next) {
                next.focus();
                if (next instanceof HTMLInputElement && TEXT_TYPES.has(next.type) && next.type !== 'date' && next.type !== 'number') {
                    const end = next.value.length;
                    try {
                        next.setSelectionRange(end, end);
                    } catch {
                        // nicht jeder Typ unterstützt eine Auswahl
                    }
                }
            } else {
                current.blur();
            }
        };

        root.addEventListener('focusin', onFocusIn);
        root.addEventListener('keydown', onKeyDown);
        return () => {
            root.removeEventListener('focusin', onFocusIn);
            root.removeEventListener('keydown', onKeyDown);
        };
    }, [ref, resetKey]);
}
