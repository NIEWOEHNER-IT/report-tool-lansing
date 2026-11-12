/**
 * Einfaches Rate-Limit im Arbeitsspeicher (gleitendes Fenster je Schlüssel).
 */
import { ErrorCodes } from '../../../shared/contract';
import { ApiFailure } from '../errors';
import type { Logger } from '../logger';

export interface RateLimitOptions {
    windowMs: number;
    max: number;
    name: string;
    logger?: Logger;
}

export interface RateLimiter {
    /** Wirft RATE_LIMITED, wenn das Fenster erschöpft ist. */
    check(key: string): void;
    size(): number;
}

export function createRateLimiter(options: RateLimitOptions): RateLimiter {
    const hits = new Map<string, number[]>();
    let lastCleanup = Date.now();

    function cleanup(now: number): void {
        for (const [key, timestamps] of hits) {
            const fresh = timestamps.filter((at) => now - at < options.windowMs);
            if (fresh.length === 0) hits.delete(key);
            else hits.set(key, fresh);
        }
        lastCleanup = now;
    }

    return {
        check(key: string): void {
            const now = Date.now();
            if (now - lastCleanup > options.windowMs) cleanup(now);
            const timestamps = (hits.get(key) ?? []).filter((at) => now - at < options.windowMs);
            if (timestamps.length >= options.max) {
                hits.set(key, timestamps);
                options.logger?.warn('http.rate_limited', { limiter: options.name, ip: key });
                throw new ApiFailure(ErrorCodes.RATE_LIMITED);
            }
            timestamps.push(now);
            hits.set(key, timestamps);
        },
        size(): number {
            return hits.size;
        },
    };
}

export interface RateLimiters {
    auth: RateLimiter;
    api: RateLimiter;
    upload: RateLimiter;
}

export function defaultRateLimiters(logger?: Logger): RateLimiters {
    return {
        auth: createRateLimiter({ name: 'auth', windowMs: 10 * 60_000, max: 20, logger }),
        api: createRateLimiter({ name: 'api', windowMs: 5 * 60_000, max: 600, logger }),
        // 512-KB-Stücke: 2000 Stück in 5 Minuten entsprechen rund 1 GB.
        upload: createRateLimiter({ name: 'upload', windowMs: 5 * 60_000, max: 2000, logger }),
    };
}
