import { Elysia } from "elysia";
import { socialAgentRoutes } from "./routes/social-agent";
import { strategistInlinks } from "./routes/strategist-inlinks";
import { contentReviewerRoutes } from "./routes/content-reviewer";
import { trendsMasterRoutes } from "./routes/trends-master";
import { authRoutes } from "./routes/auth";
import { llmGenerationRoutes } from "./routes/llm-generations";
import { envValid } from "../envSchema";
import { db } from "../db/connection";
import { sql } from "drizzle-orm";

import { cors } from "@elysiajs/cors";
import {
    getCachedAuthContext,
    isProtectedPath,
    resolveAuthContext,
    unauthorizedResponse,
} from "./plugins/auth-guard";
import { createApiErrorResponse } from "./error-response";
import {
    getRequestId,
    getRequestLatencyMs,
    initRequestContext,
} from "./request-context";
import { logHttpRequest } from "./structured-logger";

const frontendDistPath = `${process.cwd()}/front-end/dist/`;
const frontendDist = new URL(`file://${frontendDistPath}`);
const indexHtml = Bun.file(new URL("index.html", frontendDist));

const resolveToolFromPath = (pathname: string): string | undefined => {
    if (pathname === "/social-agent" || pathname.startsWith("/social-agent/")) {
        return "social-agent";
    }

    if (
        pathname === "/strategist/inlinks" ||
        pathname.startsWith("/strategist/inlinks/")
    ) {
        return "strategist-inlinks";
    }

    if (
        pathname === "/strategist/content-reviewer" ||
        pathname.startsWith("/strategist/content-reviewer/")
    ) {
        return "content-reviewer";
    }

    if (
        pathname === "/api/trends-master/run" ||
        pathname.startsWith("/api/trends-master/")
    ) {
        return "trends-master";
    }

    if (pathname === "/llm/generations" || pathname.startsWith("/llm/generations/")) {
        return "llm-generations";
    }

    if (pathname.startsWith("/auth/")) {
        return "auth";
    }

    return undefined;
};

const app = new Elysia()
    .use(
        cors({
            origin: [
                envValid.CORS_ORIGIN ?? "http://localhost:5173",
                "http://localhost:5174",
            ],
            credentials: true,
        }),
    )
    .onRequest(({ request }) => {
        initRequestContext(request);
    })
    .onError(({ code, error, request }) => {
        const requestId = getRequestId(request);
        if (code === "VALIDATION") {
            return createApiErrorResponse({
                status: 422,
                code: "VALIDATION_ERROR",
                message: "Payload inválido.",
                requestId,
                details: error,
            });
        }

        if (code === "PARSE") {
            return createApiErrorResponse({
                status: 400,
                code: "PARSE_ERROR",
                message: "Não foi possível interpretar o payload.",
                requestId,
                details: error,
            });
        }

        console.error("[Server] Internal error:", {
            requestId,
            error,
        });

        return createApiErrorResponse({
            status: 500,
            code: "INTERNAL_ERROR",
            message: "Falha interna ao processar a requisição.",
            requestId,
            details: error,
        });
    })
    .onBeforeHandle(async ({ request }) => {
        const { pathname } = new URL(request.url);
        if (!isProtectedPath(pathname)) {
            return;
        }

        const authContext = await resolveAuthContext(request);
        if (!authContext) {
            return unauthorizedResponse();
        }
    })
    .onAfterHandle(({ request, response, set }) => {
        const requestId = getRequestId(request);
        const { pathname } = new URL(request.url);
        const tool = resolveToolFromPath(pathname);
        const authContext = getCachedAuthContext(request);
        const inferredStatus =
            response instanceof Response
                ? response.status
                : typeof set.status === "number"
                  ? set.status
                  : 200;

        set.headers["x-request-id"] = requestId;

        logHttpRequest({
            requestId,
            method: request.method,
            path: pathname,
            tool,
            status: inferredStatus,
            latencyMs: getRequestLatencyMs(request),
            userId: authContext?.userId,
        });
    })
    .use(authRoutes)
    .use(socialAgentRoutes)
    .use(strategistInlinks)
    .use(contentReviewerRoutes)
    .use(trendsMasterRoutes)
    .use(llmGenerationRoutes)
    .get("/health", () => ({ ok: true }))
    .get("/health/db", async () => {
        try {
            await db.execute(sql`select 1`);
            return { ok: true };
        } catch (error) {
            console.error("[Health] DB unavailable:", error);
            return new Response(
                JSON.stringify({ ok: false, error: "DB_UNAVAILABLE" }),
                { status: 500, headers: { "Content-Type": "application/json" } },
            );
        }
    })
    .get("/", () => indexHtml)
    .get("/assets/*", async ({ request }) => {
        const { pathname } = new URL(request.url);
        const path = pathname.replace(/^\/+/, "");
        const file = Bun.file(new URL(path, frontendDist));
        if (await file.exists()) {
            return new Response(file, {
                headers: {
                    "Content-Type": file.type || "application/octet-stream",
                },
            });
        }
        return new Response("Not found", { status: 404 });
    })
    .get("/*", () => indexHtml);

const resolvePort = (): number => {
    const rawPort = Bun.env.PORT?.trim();
    if (!rawPort) {
        return 3333;
    }

    const port = Number(rawPort);
    return Number.isInteger(port) && port > 0 ? port : 3333;
};

const port = resolvePort();
const hostname = Bun.env.HOST?.trim() || "0.0.0.0";

app.listen({ port, hostname }, (server) => {
    console.log(`Server started on http://${server.hostname}:${server.port}`);
});
