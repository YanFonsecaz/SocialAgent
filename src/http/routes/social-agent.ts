import { Elysia } from "elysia";
import { runSocialAgent } from "../../agents/social-agent-graph";
import { z } from "zod";
import {
  resolveAuthContext,
  unauthorizedResponse,
} from "../plugins/auth-guard";
import { logLlmGeneration } from "../../use-case/log-generation";
import { buildGenerationMetrics } from "../../use-case/llm-metrics";
import { createApiErrorResponse } from "../error-response";
import { UnsafeUrlError } from "../../security/ssrf";
import { getRequestId } from "../request-context";

export const socialAgentRoutes = new Elysia().post(
  "/social-agent",
  async ({ body, request }) => {
    const requestId = getRequestId(request);
    const { url, intent, query, tone, feedback, previousResponse } = body;
    const authContext = await resolveAuthContext(request);
    if (!authContext) {
      return unauthorizedResponse();
    }
    const startedAt = Date.now();

    try {
      const result: Awaited<ReturnType<typeof runSocialAgent>> =
        await runSocialAgent({
          userId: authContext.userId,
          url,
          intent: intent || undefined,
          query: query || undefined,
          tone: tone || undefined,
          feedback: feedback || undefined,
          previousResponse: previousResponse || undefined,
        });

      const metrics = buildGenerationMetrics({
        tool: "social-agent",
        startedAt,
        model: "gpt-4o-mini",
        usage: result.usage,
      });

      const generationId = await logLlmGeneration({
        userId: authContext.userId,
        tool: "social-agent",
        model: "gpt-4o-mini",
        prompt: JSON.stringify(body),
        output: result.response,
        status: "draft",
        tokensIn: metrics.tokensIn,
        tokensOut: metrics.tokensOut,
        latencyMs: metrics.latencyMs,
        costUsd: metrics.costUsd,
      });

      return {
        generationId,
        response: result.response,
        sources: result.sources ?? [],
      };
    } catch (error) {
      console.error("Agent execution failed:", error);
      if (error instanceof UnsafeUrlError) {
        return createApiErrorResponse({
          status: 422,
          code: "INVALID_URL_TARGET",
          message: error.message,
          requestId,
        });
      }

      return createApiErrorResponse({
        status: 500,
        code: "SOCIAL_AGENT_FAILED",
        message: "Falha interna no processamento da IA.",
        requestId,
        details: error,
      });
    }
  },
  {
    body: z.object({
      url: z.url("Necessário enviar uma URL válida"),
      intent: z.string().optional(),
      query: z.string().optional(),
      tone: z.string().optional(),
      feedback: z.string().optional(),
      previousResponse: z.string().optional(),
    }),
  },
);
