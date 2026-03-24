type LogLevel = "info" | "warn" | "error";

type HttpRequestLogInput = {
    requestId: string;
    method: string;
    path: string;
    status: number;
    latencyMs: number;
    userId?: string;
    tool?: string;
};

const writeLog = (level: LogLevel, payload: Record<string, unknown>): void => {
    const line = JSON.stringify({
        timestamp: new Date().toISOString(),
        level,
        ...payload,
    });

    if (level === "error") {
        console.error(line);
        return;
    }

    if (level === "warn") {
        console.warn(line);
        return;
    }

    console.log(line);
};

export const logHttpRequest = (input: HttpRequestLogInput): void => {
    writeLog("info", {
        event: "http_request",
        requestId: input.requestId,
        method: input.method,
        path: input.path,
        status: input.status,
        latencyMs: input.latencyMs,
        userId: input.userId ?? null,
        tool: input.tool ?? null,
    });
};

export const logSecurityWarning = (input: {
    requestId?: string;
    event: string;
    message: string;
    metadata?: Record<string, unknown>;
}): void => {
    writeLog("warn", {
        event: input.event,
        requestId: input.requestId ?? null,
        message: input.message,
        ...(input.metadata ? { metadata: input.metadata } : {}),
    });
};
