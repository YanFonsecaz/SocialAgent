import { Elysia } from "elysia";
import { runSocialAgent } from "../../agents/social-agent-graph";
import { z } from "zod";

export const socialAgentRoutes = new Elysia().post(
  "/social-agent",
  async ({ body }) => {
    const { url, intent, query, tone, feedback, previousResponse } = body;

    try {
      const result: Awaited<ReturnType<typeof runSocialAgent>> =
        await runSocialAgent({
          url,
          intent: intent || undefined,
          query: query || undefined,
          tone: tone || undefined,
          feedback: feedback || undefined,
          previousResponse: previousResponse || undefined,
        });

      console.log("Agent result success");
      return {
        response: result.response,
        sources: result.sources ?? [],
      };
    } catch (error) {
      console.error("Agent execution failed:", error);
      return new Response(
        JSON.stringify({ error: "Falha internal no processamento da IA" }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        },
      );
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
