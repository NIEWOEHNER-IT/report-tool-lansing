/**
 * chayns-Dialoge (createDialog aus chayns-api) mit Browser-Fallback für den Mock-Modus.
 */
import { createDialog, DialogButtonType, DialogType, ToastType } from 'chayns-api';
import { isMockMode } from './mockMode';

export async function confirmDialog(text: string, okText = 'Ja', cancelText = 'Abbrechen'): Promise<boolean> {
    if (isMockMode()) return window.confirm(text);
    try {
        const { buttonType } = await createDialog({
            type: DialogType.CONFIRM,
            text,
            buttons: [
                { type: DialogButtonType.OK, text: okText },
                { type: DialogButtonType.CANCEL, text: cancelText },
            ],
        }).open();
        return buttonType === DialogButtonType.OK;
    } catch {
        return window.confirm(text);
    }
}

export async function alertDialog(text: string): Promise<void> {
    if (isMockMode()) {
        window.alert(text);
        return;
    }
    try {
        await createDialog({ type: DialogType.ALERT, text }).open();
    } catch {
        window.alert(text);
    }
}

/** Texteingabe (chayns-Eingabedialog). Rückgabe null = abgebrochen. */
export async function inputDialog(text: string, defaultValue: string, okText = 'OK'): Promise<string | null> {
    if (isMockMode()) return window.prompt(text, defaultValue);
    try {
        const { buttonType, result } = await createDialog({
            type: DialogType.INPUT,
            text,
            defaultValue,
            buttons: [
                { type: DialogButtonType.OK, text: okText },
                { type: DialogButtonType.CANCEL, text: 'Abbrechen' },
            ],
        }).open();
        return buttonType === DialogButtonType.OK ? String(result ?? '') : null;
    } catch {
        return window.prompt(text, defaultValue);
    }
}

export function toast(text: string, kind: 'success' | 'error' = 'success'): void {
    if (isMockMode()) return;
    try {
        void createDialog({
            type: DialogType.TOAST,
            text,
            toastType: kind === 'success' ? ToastType.SUCCESS : ToastType.ERROR,
            duration: 4000,
        }).open();
    } catch {
        // Toast ist nur Zusatzinformation.
    }
}

/** Auswahl aus einer Liste (chayns-Auswahldialog mit Suche). Rückgabe null = abgebrochen. */
export async function selectDialog(text: string, items: string[], selected: string[], multiselect = true): Promise<string[] | null> {
    if (isMockMode()) {
        const answer = window.prompt(`${text}\n(Namen mit Komma trennen)\n${items.join(', ')}`, selected.join(', '));
        return answer === null ? null : answer.split(',').map((s) => s.trim()).filter(Boolean);
    }
    try {
        const { buttonType, result } = await createDialog<string>({
            type: DialogType.SELECT,
            text,
            multiselect,
            quickfind: true,
            list: items.map((name) => ({ id: name, name, isSelected: selected.includes(name) })),
            buttons: [
                { type: DialogButtonType.OK, text: 'Übernehmen' },
                { type: DialogButtonType.CANCEL, text: 'Abbrechen' },
            ],
        }).open();
        if (buttonType !== DialogButtonType.OK) return null;
        return Array.isArray(result) ? result.map(String) : null;
    } catch {
        return null;
    }
}
