/**
 * Ambient-Typen für das globale `chayns`-Objekt in der chayns.codes-Bridge.
 * Quelle: Chayns/chayns-code-doku/docs/chayns-codes-api.md. Nur verwendete Funktionen.
 */

export {};

declare global {
    interface ChaynsCodesUacGroup {
        id: number;
        name: string;
    }

    interface ChaynsCodesApi {
        person: {
            current: {
                getId(): Promise<string>;
                getUacGroups(): Promise<ChaynsCodesUacGroup[]>;
            };
            getPublicInformation(personId: string): Promise<{ firstName?: string; lastName?: string }>;
        };
        sites: {
            current: {
                getId(): Promise<string>;
            };
        };
        ai: {
            prompt(
                text: string,
                options?: {
                    imageUrls?: string[];
                    usedModel?: number;
                    prePrompt?: string;
                    jsonResponseScheme?: unknown;
                    fallbackModel?: number;
                },
            ): Promise<string>;
        };
    }

    // eslint-disable-next-line no-var
    var chayns: ChaynsCodesApi;
}
