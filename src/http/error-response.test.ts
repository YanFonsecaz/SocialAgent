import { afterEach, expect, test } from "bun:test";
import { createApiErrorResponse } from "./error-response";

const originalNodeEnv = Bun.env.NODE_ENV;

afterEach(() => {
    if (originalNodeEnv === undefined) {
        delete Bun.env.NODE_ENV;
    } else {
        Bun.env.NODE_ENV = originalNodeEnv;
    }
});

test("createApiErrorResponse: remove detalhes em produção", async () => {
    Bun.env.NODE_ENV = "production";

    const response = createApiErrorResponse({
        status: 500,
        code: "INTERNAL_ERROR",
        message: "Falha",
        details: { stack: "stacktrace" },
    });

    const payload = (await response.json()) as Record<string, unknown>;
    expect(payload.debug).toBeUndefined();
});

test("createApiErrorResponse: inclui debug fora de produção", async () => {
    Bun.env.NODE_ENV = "development";

    const response = createApiErrorResponse({
        status: 400,
        code: "BAD_REQUEST",
        message: "Erro",
        details: { field: "email" },
    });

    const payload = (await response.json()) as { debug?: unknown };
    expect(payload.debug).toEqual({ field: "email" });
});
