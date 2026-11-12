/**
 * Hinweis-/Fehlermeldung als chayns ContentCard (passt sich Site-Farben und Dunkelmodus an).
 */
import type { ReactNode } from 'react';
import { ContentCard, ContentCardType } from '@chayns-components/core';

export type NoticeType = 'info' | 'warning' | 'error' | 'success';

const TYPES: Record<NoticeType, ContentCardType> = {
    info: ContentCardType.Default,
    warning: ContentCardType.Warning,
    error: ContentCardType.Error,
    success: ContentCardType.Success,
};

export function Notice({ type = 'info', children }: { type?: NoticeType; children: ReactNode }) {
    return (
        <ContentCard type={TYPES[type]}>
            <div className="notice">{children}</div>
        </ContentCard>
    );
}
