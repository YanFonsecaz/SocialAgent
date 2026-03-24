import { randomUUID } from "node:crypto";

const requestIds = new WeakMap<Request, string>();
const requestStartedAts = new WeakMap<Request, number>();

const normalizeRequestId = (value: string | null): string | null => {
    if (!value) {
        return null;
    }

    const trimmed = value.trim();
    if (!trimmed || trimmed.length > 128) {
        return null;
    }

    return trimmed;
};

export const initRequestContext = (request: Request): void => {
    if (!requestIds.has(request)) {
        const incomingId = normalizeRequestId(request.headers.get("x-request-id"));
        requestIds.set(request, incomingId ?? randomUUID());
    }

    if (!requestStartedAts.has(request)) {
        requestStartedAts.set(request, Date.now());
    }
};

export const getRequestId = (request: Request): string => {
    if (!requestIds.has(request)) {
        initRequestContext(request);
    }

    return requestIds.get(request) as string;
};

export const getRequestStartedAt = (request: Request): number => {
    if (!requestStartedAts.has(request)) {
        initRequestContext(request);
    }

    return requestStartedAts.get(request) as number;
};

export const getRequestLatencyMs = (request: Request): number =>
    Math.max(0, Date.now() - getRequestStartedAt(request));
