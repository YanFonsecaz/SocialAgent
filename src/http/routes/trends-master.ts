import { Elysia } from "elysia";

import { TrendsConfigSchema } from "../../trends-master/types";
import { runTrendsMasterPipeline } from "../../trends-master/run-trends-master";
import {
    loadTrendsConfig,
    saveTrendsConfig,
} from "../../trends-master/repositories/config-repository";
import {
    resolveAuthContext,
    unauthorizedResponse,
} from "../plugins/auth-guard";
import { logLlmGeneration } from "../../use-case/log-generation";
import { buildGenerationMetrics } from "../../use-case/llm-metrics";
import { createApiErrorResponse } from "../error-response";
import { getRequestId } from "../request-context";

const TrendsConfigUpdateSchema = TrendsConfigSchema;

export const trendsMasterRoutes = new Elysia()
    .post(
        "/api/trends-master/run",
        async ({ body, request }) => {
            const requestId = getRequestId(request);
            const authContext = await resolveAuthContext(request);
            if (!authContext) {
                return unauthorizedResponse();
            }
            const startedAt = Date.now();

            try {
                const parsed = TrendsConfigSchema.parse(body);
                const result = await runTrendsMasterPipeline(parsed);

                const generationId = await logLlmGeneration({
                    userId: authContext.userId,
                    tool: "trends-master",
                    model: "gpt-4o-mini",
                    prompt: JSON.stringify(parsed),
                    output: JSON.stringify(result),
                    status: "draft",
                    ...buildGenerationMetrics({
                        tool: "trends-master",
                        startedAt,
                        model: "gpt-4o-mini",
                        usage: result.success ? result.usage : undefined,
                    }),
                });

                return {
                    ...result,
                    generationId,
                };
            } catch (error) {
                return createApiErrorResponse({
                    status: 500,
                    code: "TRENDS_MASTER_RUN_FAILED",
                    message: "Falha ao executar o Trends Master.",
                    requestId,
                    details: error,
                });
            }
        },
        {
            body: TrendsConfigSchema,
        },
    )
    .get("/api/trends-master/config", async ({ request }) => {
        const requestId = getRequestId(request);
        const authContext = await resolveAuthContext(request);
        if (!authContext) {
            return unauthorizedResponse();
        }

        try {
            const config = await loadTrendsConfig(authContext.userId);
            return { success: true, config };
        } catch (error) {
            console.error("[Trends Config] Falha ao carregar:", error);
            return createApiErrorResponse({
                status: 500,
                code: "TRENDS_CONFIG_LOAD_FAILED",
                message: "Falha ao carregar configuração do Trends Master.",
                requestId,
                details: error,
            });
        }
    })
    .put(
        "/api/trends-master/config",
        async ({ body, request, set }) => {
            const requestId = getRequestId(request);
            const authContext = await resolveAuthContext(request);
            if (!authContext) {
                return unauthorizedResponse();
            }

            const parsed = TrendsConfigUpdateSchema.parse(body);
            const saved = await saveTrendsConfig(authContext.userId, parsed);
            if (!saved) {
                set.status = 500;
                return createApiErrorResponse({
                    status: 500,
                    code: "TRENDS_CONFIG_SAVE_FAILED",
                    message: "Falha ao salvar configuração do Trends Master.",
                    requestId,
                });
            }
            return { success: true };
        },
        {
            body: TrendsConfigUpdateSchema,
        },
    );
