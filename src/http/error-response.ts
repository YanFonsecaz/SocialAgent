type ApiErrorCode =
    | "UNAUTHORIZED"
    | "FORBIDDEN"
    | "BAD_REQUEST"
    | "VALIDATION_ERROR"
    | "PARSE_ERROR"
    | "INTERNAL_ERROR"
    | "RATE_LIMITED"
    | "NOT_FOUND"
    | "CONFLICT"
    | string;

type CreateApiErrorResponseInput = {
    status: number;
    code: ApiErrorCode;
    message: string;
    requestId?: string;
    details?: unknown;
    headers?: HeadersInit;
};

const isProduction = (): boolean =>
    (Bun.env.NODE_ENV ?? "").trim().toLowerCase() === "production";

export const createApiErrorResponse = (
    input: CreateApiErrorResponseInput,
): Response => {
    const payload: Record<string, unknown> = {
        success: false,
        error: {
            code: input.code,
            message: input.message,
            ...(input.requestId ? { requestId: input.requestId } : {}),
        },
    };

    if (!isProduction() && input.details !== undefined) {
        payload.debug = input.details;
    }

    const headers = new Headers(input.headers);
    headers.set("Content-Type", "application/json");

    return new Response(JSON.stringify(payload), {
        status: input.status,
        headers,
    });
};

export const createApiSuccessResponse = <T>(
    data: T,
    init?: { status?: number; headers?: HeadersInit },
): Response => {
    const headers = new Headers(init?.headers);
    headers.set("Content-Type", "application/json");

    return new Response(JSON.stringify(data), {
        status: init?.status ?? 200,
        headers,
    });
};
