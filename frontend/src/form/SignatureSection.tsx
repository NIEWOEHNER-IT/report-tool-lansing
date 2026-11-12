/**
 * Unterschriften Auftraggeber und LANSING (leitender Monteur), wie V46.
 * Optional: Kopie des PDFs per E-Mail an den Auftraggeber (Versand durch den Server nach dem Speichern).
 */
import { useState } from 'react';
import { Checkbox, Input } from '@chayns-components/core';
import { isValidEmail } from '../../../shared/contract';
import { Field } from './components/Field';
import { SignaturePad } from './components/SignaturePad';
import type { SectionProps } from './sections';

export function SignatureSection({ draft, update }: SectionProps) {
    const [wantsCopy, setWantsCopy] = useState(draft.auftraggeberEmail !== '');
    return (
        <div className="signatures">
            <div className="stack">
                <strong>Auftraggeber</strong>
                <Field label="Name">
                    <Input
                        placeholder="Name des Auftraggebers / Vertreters"
                        value={draft.unterschriftAuftraggeber.name}
                        onChange={(event) => update((d) => ({ ...d, unterschriftAuftraggeber: { ...d.unterschriftAuftraggeber, name: event.target.value } }))}
                    />
                </Field>
                <SignaturePad
                    value={draft.unterschriftAuftraggeber.image}
                    onChange={(image) => update((d) => ({ ...d, unterschriftAuftraggeber: { ...d.unterschriftAuftraggeber, image } }))}
                />
                <Checkbox
                    isChecked={wantsCopy}
                    onChange={(event) => {
                        setWantsCopy(event.target.checked);
                        if (!event.target.checked) update({ auftraggeberEmail: '' });
                    }}
                >
                    Kopie per E-Mail gewünscht
                </Checkbox>
                {wantsCopy && (
                    <Field label="E-Mail-Adresse" hint="Der Auftraggeber erhält das PDF nach dem Speichern per E-Mail.">
                        <Input
                            type="email"
                            inputMode="email"
                            autoComplete="email"
                            placeholder="name@beispiel.de"
                            value={draft.auftraggeberEmail}
                            isInvalid={draft.auftraggeberEmail !== '' && !isValidEmail(draft.auftraggeberEmail)}
                            onChange={(event) => update({ auftraggeberEmail: event.target.value.trim() })}
                        />
                    </Field>
                )}
            </div>
            <div className="stack">
                <strong>LANSING</strong>
                <Field label="Name (leitender Monteur)">
                    <Input value={draft.leitenderMonteur} placeholder="Im Abschnitt Projekt eintragen" isDisabled />
                </Field>
                <SignaturePad
                    value={draft.unterschriftLansing.image}
                    isDisabled={!draft.leitenderMonteur.trim()}
                    onChange={(image) => update((d) => ({ ...d, unterschriftLansing: { ...d.unterschriftLansing, image } }))}
                />
            </div>
        </div>
    );
}
