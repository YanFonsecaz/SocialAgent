type RateLimitState = {
    count: number;
    resetAtMs: number;
};

type ConsumeRateLimitInput = {
    key: string;
    limit: number;
    windowMs: number;
    nowMs?: number;
};

export type RateLimitResult = {
    allowed: boolean;
    remaining: number;
    retryAfterSec: number;
};

const store = new Map<string, RateLimitState>();

const toKey = (key: string): string => key.trim().toLowerCase();

const safeCeilSeconds = (ms: number): number => Math.max(1, Math.ceil(ms / 1000));

export const consumeRateLimit = (
    input: ConsumeRateLimitInput,
): RateLimitResult => {
    const key = toKey(input.key);
    const nowMs = input.nowMs ?? Date.now();
    const existing = store.get(key);

    if (!existing || existing.resetAtMs <= nowMs) {
        const nextState: RateLimitState = {
            count: 1,
            resetAtMs: nowMs + input.windowMs,
        };
        store.set(key, nextState);
        return {
            allowed: true,
            remaining: Math.max(0, input.limit - 1),
            retryAfterSec: safeCeilSeconds(input.windowMs),
        };
    }

    if (existing.count >= input.limit) {
        return {
            allowed: false,
            remaining: 0,
            retryAfterSec: safeCeilSeconds(existing.resetAtMs - nowMs),
        };
    }

    existing.count += 1;
    store.set(key, existing);
    return {
        allowed: true,
        remaining: Math.max(0, input.limit - existing.count),
        retryAfterSec: safeCeilSeconds(existing.resetAtMs - nowMs),
    };
};

export const clearRateLimitStore = (): void => {
    store.clear();
};
