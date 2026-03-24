import { Elysia } from "elysia";
import { z } from "zod";
import {
    approveLlmGenerationByUser,
    isValidGenerationStatusTransition,
    listLlmGenerationsByUser,
    parseGenerationListFilters,
} from "../../use-case/llm-generations";
import { resolveAuthContext, unauthorizedResponse } from "../plugins/auth-guard";
import { createApiErrorResponse } from "../error-response";
import { getRequestId } from "../request-context";

const approveBodySchema = z.object({
    status: z.literal("approved"),
});

const generationParamsSchema = z.object({
    id: z.string().min(1),
});

export const llmGenerationRoutes = new Elysia()
    .get("/llm/generations", async ({ request }) => {
        const requestId = getRequestId(request);
        const authContext = await resolveAuthContext(request);
        if (!authContext) {
            return unauthorizedResponse();
        }

        let filters;
        try {
            filters = parseGenerationListFilters(new URL(request.url).searchParams);
        } catch (error) {
            return createApiErrorResponse({
                status: 400,
                code: "BAD_REQUEST",
                message:
                    error instanceof Error
                        ? error.message
                        : "Parâmetros inválidos.",
                requestId,
                details: error,
            });
        }

        const result = await listLlmGenerationsByUser(authContext.userId, filters);

        return {
            items: result.items,
            page: filters.page,
            pageSize: filters.pageSize,
            total: result.total,
        };
    })
    .patch(
        "/llm/generations/:id/status",
        async ({ request, params, body }) => {
            const requestId = getRequestId(request);
            const authContext = await resolveAuthContext(request);
            if (!authContext) {
                return unauthorizedResponse();
            }

            const parsedParams = generationParamsSchema.safeParse(params);
            if (!parsedParams.success) {
                return createApiErrorResponse({
                    status: 400,
                    code: "BAD_REQUEST",
                    message: "Parâmetro id inválido.",
                    requestId,
                    details: parsedParams.error.issues,
                });
            }

            const parsedBody = approveBodySchema.safeParse(body);
            if (!parsedBody.success) {
                return createApiErrorResponse({
                    status: 400,
                    code: "BAD_REQUEST",
                    message: "Payload inválido.",
                    requestId,
                    details: parsedBody.error.issues,
                });
            }

            if (!isValidGenerationStatusTransition("draft", parsedBody.data.status)) {
                return createApiErrorResponse({
                    status: 400,
                    code: "BAD_REQUEST",
                    message: "Transição de status inválida.",
                    requestId,
                });
            }

            const result = await approveLlmGenerationByUser(
                authContext.userId,
                parsedParams.data.id,
            );

            if (result.kind === "not_found") {
                return createApiErrorResponse({
                    status: 404,
                    code: "NOT_FOUND",
                    message: "GENERATION_NOT_FOUND",
                    requestId,
                });
            }

            if (result.kind === "invalid_transition") {
                return createApiErrorResponse({
                    status: 409,
                    code: "CONFLICT",
                    message: "INVALID_STATUS_TRANSITION",
                    requestId,
                });
            }

            return {
                success: true,
                generation: result.generation,
            };
        },
    );
